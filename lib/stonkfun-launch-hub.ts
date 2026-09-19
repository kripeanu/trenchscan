import type { Connection } from "@solana/web3.js";
import { createSolanaConnection } from "@/lib/pump";
import {
  looksLikeStonkFunInitialize,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  type StonkFunLaunch,
} from "@/lib/stonkfun";
import { loadStonkFunReplayBySignature } from "@/lib/stonkfun-replay";
import type { StreamStatus } from "@/lib/types";

const MAX_BUFFERED_LAUNCHES = 40;
const INITIAL_RETRY_MS = 3_000;
const MAX_RETRY_MS = 30_000;

type StonkFunHubEvent =
  | { type: "status"; payload: StreamStatus }
  | { type: "launch"; payload: StonkFunLaunch };

type StonkFunHubListener = (event: StonkFunHubEvent) => void;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

class StonkFunLaunchHub {
  private readonly connection: Connection;
  private readonly listeners = new Set<StonkFunHubListener>();
  private readonly recentLaunches: StonkFunLaunch[] = [];
  private subscriptionId: number | null = null;
  private startPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
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

  private async handleLogs(
    notification: {
      signature: string;
      err: unknown;
      logs: string[];
    },
  ) {
    if (
      notification.err ||
      !this.listeners.size ||
      !looksLikeStonkFunInitialize(notification.logs)
    ) {
      return;
    }

    this.candidatesSeen += 1;

    // LaunchLab is shared infrastructure. The exact transaction decoder below
    // is the second gate that checks StonkFun's platform_config before anything
    // is emitted to clients.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const replay = await loadStonkFunReplayBySignature(
          this.connection,
          notification.signature,
        );

        if (replay) {
          this.pushLaunch(replay.launch);
        } else {
          this.candidatesRejected += 1;
        }

        return;
      } catch (error) {
        if (attempt < 2) {
          await sleep(300 * (attempt + 1));
          continue;
        }

        this.lastErrorAt = Date.now();
        console.error(
          "[trenchscan] StonkFun live candidate decode failed",
          notification.signature,
          error,
        );
      }
    }
  }

  private async start() {
    this.setStatus({
      state: "connecting",
      program: RAYDIUM_LAUNCHLAB_PROGRAM_ID.toBase58(),
    });

    try {
      this.subscriptionId = await this.connection.onLogs(
        RAYDIUM_LAUNCHLAB_PROGRAM_ID,
        (notification) => {
          void this.handleLogs(notification);
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
