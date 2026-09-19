import { getLaunchHub } from "@/lib/launch-hub";
import {
  pumpLaunchEnvelope,
  stonkFunLaunchEnvelope,
  type LaunchSource,
} from "@/lib/launch-source";
import { getStonkFunLaunchHub } from "@/lib/stonkfun-launch-hub";
import {
  combineStreamStatuses,
  INITIAL_SOURCE_STATUSES,
  type SourceStreamStatuses,
} from "@/lib/unified-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: string, payload: unknown) {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

export async function GET(request: Request) {
  const pumpHub = getLaunchHub();
  const stonkFunHub = getStonkFunLaunchHub();

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const unsubscribers: Array<() => void> = [];
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;

    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }

    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;

        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      let sourceStatuses: SourceStreamStatuses = {
        "pump.fun": { ...INITIAL_SOURCE_STATUSES["pump.fun"] },
        "stonkfun.xyz": { ...INITIAL_SOURCE_STATUSES["stonkfun.xyz"] },
      };

      const updateStatus = (
        source: LaunchSource,
        status: SourceStreamStatuses[LaunchSource],
      ) => {
        sourceStatuses = { ...sourceStatuses, [source]: status };
        safeEnqueue(sse("status", combineStreamStatuses(sourceStatuses)));
      };

      unsubscribers.push(
        pumpHub.subscribe((event) => {
          if (event.type === "status") {
            updateStatus("pump.fun", event.payload);
            return;
          }

          safeEnqueue(sse("launch", pumpLaunchEnvelope(event.payload)));
        }),
        stonkFunHub.subscribe((event) => {
          if (event.type === "status") {
            updateStatus("stonkfun.xyz", event.payload);
            return;
          }

          safeEnqueue(
            sse("launch", stonkFunLaunchEnvelope(event.payload)),
          );
        }),
      );

      keepAlive = setInterval(() => {
        safeEnqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", cleanup, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-TrenchScan-Sources": "pump.fun,stonkfun.xyz",
    },
  });
}
