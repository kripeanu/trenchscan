import type { Connection } from "@solana/web3.js";
import {
  createSolanaConnection,
  decodeLaunch,
  looksLikeCreate,
  PUMP_PROGRAM_ID,
} from "@/lib/pump";
import type { Launch, StreamStatus } from "@/lib/types";

const MAX_BUFFERED_LAUNCHES = 80;
const INITIAL_RETRY_MS = 3_000;
const MAX_RETRY_MS = 30_000;

type HubEvent =
  | { type: "status"; payload: StreamStatus }
  | { type: "launch"; payload: Launch };

type HubListener = (event: HubEvent) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class LaunchHub {
  private readonly connection: Connection;
  private readonly listeners = new Set<HubListener>();
  private readonly recentLaunches: Launch[] = [];
  private subscriptionId: number | null = null;
  private startPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
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
      lastLaunchAt: this.lastLaunchAt,
      lastErrorAt: this.lastErrorAt,
      uptimeMs: Math.max(0, Date.now() - this.startedAt),
      program: PUMP_PROGRAM_ID.toBase58(),
    };
  }

  subscribe(listener: HubListener) {
    this.listeners.add(listener);

    listener({ type: "status", payload: this.status });

    // Send oldest -> newest because the client prepends each SSE launch.
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

  private async handleLogs(
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

    // Websocket log delivery can beat getParsedTransaction by a fraction of a
    // second. Retry briefly before dropping a real launch.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const launch = await decodeLaunch(
          this.connection,
          notification.signature,
          slot,
        );

        if (launch) this.pushLaunch(launch);
        return;
      } catch (error) {
        if (attempt < 2) {
          await sleep(300 * (attempt + 1));
          continue;
        }

        console.error(
          "[trenchscan] launch hub failed to decode",
          notification.signature,
          error,
        );
      }
    }
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
          void this.handleLogs(notification, context.slot);
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
