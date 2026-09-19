import type { Connection } from "@solana/web3.js";
import {
  createSolanaConnection,
  decodeLaunchFromTransaction,
  looksLikeCreate,
  PUMP_PROGRAM_ID,
} from "@/lib/pump";
import {
  MAX_SUPPORTED_TRANSACTION_VERSION,
  withRpcRetry,
} from "@/lib/rpc";
import type { Launch, StreamStatus } from "@/lib/types";

const MAX_BUFFERED_LAUNCHES = 80;
const INITIAL_RETRY_MS = 3_000;
const MAX_RETRY_MS = 30_000;
const DECODE_BATCH_SIZE = 20;
const DECODE_BATCH_DELAY_MS = 120;
const MAX_DECODE_ATTEMPTS = 4;

type HubEvent =
  | { type: "status"; payload: StreamStatus }
  | { type: "launch"; payload: Launch };

type HubListener = (event: HubEvent) => void;

type PendingLaunch = {
  signature: string;
  slot: number;
  attempts: number;
};

class LaunchHub {
  private readonly connection: Connection;
  private readonly listeners = new Set<HubListener>();
  private readonly recentLaunches: Launch[] = [];
  private readonly pendingLaunches = new Map<string, PendingLaunch>();
  private subscriptionId: number | null = null;
  private startPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private decodeTimer: ReturnType<typeof setTimeout> | null = null;
  private decoding = false;
  private retryMs = INITIAL_RETRY_MS;
  private startedAt = Date.now();
  private lastLaunchAt: number | null = null;
  private lastErrorAt: number | null = null;
  private status: StreamStatus = {
    state: "connecting",
    program: PUMP_PROGRAM_ID.toBase58(),
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
      pendingLaunches: this.pendingLaunches.size,
      lastLaunchAt: this.lastLaunchAt,
      lastErrorAt: this.lastErrorAt,
      uptimeMs: Math.max(0, Date.now() - this.startedAt),
      program: PUMP_PROGRAM_ID.toBase58(),
    };
  }

  subscribe(listener: HubListener) {
    this.listeners.add(listener);

    listener({ type: "status", payload: this.status });

    // Send oldest -> newest because the client merges into newest-first order.
    for (const launch of [...this.recentLaunches].reverse()) {
      listener({ type: "launch", payload: launch });
    }

    void this.ensureStarted();

    return () => {
      this.listeners.delete(listener);
    };
  }

  private broadcast(event: HubEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("[trenchscan] launch hub listener failed", error);
      }
    }
  }

  private setStatus(status: StreamStatus) {
    this.status = status;
    this.broadcast({ type: "status", payload: status });
  }

  private pushLaunch(launch: Launch) {
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

  private enqueueLaunch(signature: string, slot: number, attempts = 0) {
    if (
      this.recentLaunches.some((launch) => launch.signature === signature) ||
      this.pendingLaunches.has(signature)
    ) {
      return;
    }

    this.pendingLaunches.set(signature, { signature, slot, attempts });
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
    if (this.decoding || !this.pendingLaunches.size) return;

    const batch = [...this.pendingLaunches.values()].slice(
      0,
      DECODE_BATCH_SIZE,
    );
    for (const row of batch) this.pendingLaunches.delete(row.signature);

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
            this.enqueueLaunch(
              candidate.signature,
              candidate.slot,
              candidate.attempts + 1,
            );
          }
          return;
        }

        const launch = decodeLaunchFromTransaction(
          transaction,
          candidate.signature,
          candidate.slot,
          transaction.blockTime != null
            ? transaction.blockTime * 1000
            : Date.now(),
        );

        if (launch) this.pushLaunch(launch);
      });
    } catch (error) {
      this.lastErrorAt = Date.now();
      console.warn(
        "[trenchscan] batched Pump launch decode delayed",
        error,
      );

      for (const candidate of batch) {
        if (candidate.attempts + 1 < MAX_DECODE_ATTEMPTS) {
          this.enqueueLaunch(
            candidate.signature,
            candidate.slot,
            candidate.attempts + 1,
          );
        }
      }
    } finally {
      this.decoding = false;
      if (this.pendingLaunches.size) this.scheduleDecode(180);
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
      !looksLikeCreate(notification.logs)
    ) {
      return;
    }

    // Batch exact transaction reads. The old one-request-per-launch path could
    // self-rate-limit during bursts and silently drop real launches.
    this.enqueueLaunch(notification.signature, slot);
  }

  private async start() {
    this.setStatus({
      state: "connecting",
      program: PUMP_PROGRAM_ID.toBase58(),
    });

    try {
      this.subscriptionId = await this.connection.onLogs(
        PUMP_PROGRAM_ID,
        (notification, context) => {
          this.handleLogs(notification, context.slot);
        },
        "confirmed",
      );

      this.retryMs = INITIAL_RETRY_MS;
      this.setStatus({
        state: "live",
        program: PUMP_PROGRAM_ID.toBase58(),
      });
    } catch (error) {
      this.subscriptionId = null;
      this.lastErrorAt = Date.now();
      console.error("[trenchscan] shared websocket subscription failed", error);

      this.setStatus({
        state: "error",
        program: PUMP_PROGRAM_ID.toBase58(),
        message: "Shared Solana listener failed. Retrying automatically.",
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

const globalForHub = globalThis as unknown as {
  trenchScanLaunchHub?: LaunchHub;
};

export function getLaunchHub() {
  if (!globalForHub.trenchScanLaunchHub) {
    globalForHub.trenchScanLaunchHub = new LaunchHub();
  }

  return globalForHub.trenchScanLaunchHub;
}
