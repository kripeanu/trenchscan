import type { Connection } from "@solana/web3.js";
import { createSolanaConnection } from "@/lib/pump";
import {
  decodeStonkFunLaunchFromTransaction,
  looksLikeStonkFunInitialize,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  type StonkFunLaunch,
} from "@/lib/stonkfun";
import {
  MAX_SUPPORTED_TRANSACTION_VERSION,
  withRpcRetry,
} from "@/lib/rpc";
import type { StreamStatus } from "@/lib/types";

const MAX_BUFFERED_LAUNCHES = 40;
const INITIAL_RETRY_MS = 3_000;
const MAX_RETRY_MS = 30_000;
const DECODE_BATCH_SIZE = 12;
const DECODE_BATCH_DELAY_MS = 140;
const MAX_DECODE_ATTEMPTS = 4;

type StonkFunHubEvent =
  | { type: "status"; payload: StreamStatus }
  | { type: "launch"; payload: StonkFunLaunch };

type StonkFunHubListener = (event: StonkFunHubEvent) => void;

type PendingCandidate = {
  signature: string;
  slot: number;
  attempts: number;
};

class StonkFunLaunchHub {
  private readonly connection: Connection;
  private readonly listeners = new Set<StonkFunHubListener>();
  private readonly recentLaunches: StonkFunLaunch[] = [];
  private readonly pendingCandidates = new Map<string, PendingCandidate>();
  private subscriptionId: number | null = null;
  private startPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private decodeTimer: ReturnType<typeof setTimeout> | null = null;
  private decoding = false;
  private retryMs = INITIAL_RETRY_MS;
  private startedAt = Date.now();
  private lastLaunchAt: number | null = null;
  private lastErrorAt: number | null = null;
  private candidatesSeen = 0;
  private candidatesRejected = 0;
  private status: StreamStatus = {
    state: "connecting",
    program: RAYDIUM_LAUNCHLAB_PROGRAM_ID.toBase58(),
  };

  constructor() {
    this.connection = createSolanaConnection();
  }

  diagnostics() {
    return {
      status: this.status,
      subscriptionActive: this.subscriptionId !== null,
      listeners: this.listeners.size,
      bufferedLaunches: this.recentLaunches.length,
      pendingCandidates: this.pendingCandidates.size,
      candidatesSeen: this.candidatesSeen,
      candidatesRejected: this.candidatesRejected,
      lastLaunchAt: this.lastLaunchAt,
      lastErrorAt: this.lastErrorAt,
      uptimeMs: Math.max(0, Date.now() - this.startedAt),
      program: RAYDIUM_LAUNCHLAB_PROGRAM_ID.toBase58(),
    };
  }

  subscribe(listener: StonkFunHubListener) {
    this.listeners.add(listener);
    listener({ type: "status", payload: this.status });

    for (const launch of [...this.recentLaunches].reverse()) {
      listener({ type: "launch", payload: launch });
    }

    void this.ensureStarted();

    return () => {
      this.listeners.delete(listener);
    };
  }

  private broadcast(event: StonkFunHubEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("[trenchscan] StonkFun hub listener failed", error);
      }
    }
  }

  private setStatus(status: StreamStatus) {
    this.status = status;
    this.broadcast({ type: "status", payload: status });
  }

  private pushLaunch(launch: StonkFunLaunch) {
    if (this.recentLaunches.some((item) => item.id === launch.id)) return;

    this.lastLaunchAt = Date.now();
    this.recentLaunches.unshift(launch);

    if (this.recentLaunches.length > MAX_BUFFERED_LAUNCHES) {
      this.recentLaunches.length = MAX_BUFFERED_LAUNCHES;
    }

    this.broadcast({ type: "launch", payload: launch });
  }

  private scheduleRetry() {
    if (this.retryTimer) return;

    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureStarted();
    }, delay);
  }

  private enqueueCandidate(signature: string, slot: number, attempts = 0) {
    if (
      this.recentLaunches.some((launch) => launch.signature === signature) ||
      this.pendingCandidates.has(signature)
    ) {
      return;
    }

    this.pendingCandidates.set(signature, { signature, slot, attempts });
    this.scheduleDecode(DECODE_BATCH_DELAY_MS);
  }

  private scheduleDecode(delayMs: number) {
    if (this.decodeTimer || this.decoding) return;

    this.decodeTimer = setTimeout(() => {
      this.decodeTimer = null;
      void this.flushDecodeQueue();
    }, delayMs);
  }

  private async flushDecodeQueue() {
    if (this.decoding || !this.pendingCandidates.size) return;

    const batch = [...this.pendingCandidates.values()].slice(
      0,
      DECODE_BATCH_SIZE,
    );
    for (const row of batch) this.pendingCandidates.delete(row.signature);

    this.decoding = true;

    try {
      const transactions = await withRpcRetry(
        () =>
          this.connection.getParsedTransactions(
            batch.map((row) => row.signature),
            {
              commitment: "confirmed",
              maxSupportedTransactionVersion:
                MAX_SUPPORTED_TRANSACTION_VERSION,
            },
          ),
        [350, 700, 1_400, 2_800],
      );

      transactions.forEach((transaction, index) => {
        const candidate = batch[index];
        if (!candidate) return;

        if (!transaction) {
          if (candidate.attempts + 1 < MAX_DECODE_ATTEMPTS) {
            this.enqueueCandidate(
              candidate.signature,
              candidate.slot,
              candidate.attempts + 1,
            );
          }
          return;
        }

        const launch = decodeStonkFunLaunchFromTransaction(
          transaction,
          candidate.signature,
          candidate.slot,
          transaction.blockTime != null
            ? transaction.blockTime * 1000
            : Date.now(),
        );

        if (launch) {
          this.pushLaunch(launch);
        } else {
          this.candidatesRejected += 1;
        }
      });
    } catch (error) {
      this.lastErrorAt = Date.now();
      console.warn(
        "[trenchscan] batched LaunchLab candidate decode delayed",
        error,
      );

      for (const candidate of batch) {
        if (candidate.attempts + 1 < MAX_DECODE_ATTEMPTS) {
          this.enqueueCandidate(
            candidate.signature,
            candidate.slot,
            candidate.attempts + 1,
          );
        }
      }
    } finally {
      this.decoding = false;
      if (this.pendingCandidates.size) this.scheduleDecode(180);
    }
  }

  private handleLogs(
    notification: {
      signature: string;
      err: unknown;
      logs: string[];
    },
    slot: number,
  ) {
    if (
      notification.err ||
      !this.listeners.size ||
      !looksLikeStonkFunInitialize(notification.logs)
    ) {
      return;
    }

    this.candidatesSeen += 1;
    this.enqueueCandidate(notification.signature, slot);
  }

  private async start() {
    this.setStatus({
      state: "connecting",
      program: RAYDIUM_LAUNCHLAB_PROGRAM_ID.toBase58(),
    });

    try {
      this.subscriptionId = await this.connection.onLogs(
        RAYDIUM_LAUNCHLAB_PROGRAM_ID,
        (notification, context) => {
          this.handleLogs(notification, context.slot);
        },
        "confirmed",
      );

      this.retryMs = INITIAL_RETRY_MS;
      this.setStatus({
        state: "live",
        program: RAYDIUM_LAUNCHLAB_PROGRAM_ID.toBase58(),
      });
    } catch (error) {
      this.subscriptionId = null;
      this.lastErrorAt = Date.now();

      console.error(
        "[trenchscan] StonkFun websocket subscription failed",
        error,
      );

      this.setStatus({
        state: "error",
        program: RAYDIUM_LAUNCHLAB_PROGRAM_ID.toBase58(),
        message:
          "LaunchLab listener failed. Retrying automatically.",
      });

      this.scheduleRetry();
    }
  }

  private async ensureStarted() {
    if (this.subscriptionId !== null || this.startPromise) return;

    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });

    await this.startPromise;
  }
}

const globalForStonkFunHub = globalThis as unknown as {
  trenchScanStonkFunLaunchHub?: StonkFunLaunchHub;
};

export function getStonkFunLaunchHub() {
  if (!globalForStonkFunHub.trenchScanStonkFunLaunchHub) {
    globalForStonkFunHub.trenchScanStonkFunLaunchHub =
      new StonkFunLaunchHub();
  }

  return globalForStonkFunHub.trenchScanStonkFunLaunchHub;
}
