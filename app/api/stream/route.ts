import { getLaunchHub } from "@/lib/launch-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: string, payload: unknown) {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
  );
}

export async function GET(request: Request) {
  const hub = getLaunchHub();

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;

    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }

    unsubscribe?.();
    unsubscribe = null;
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

      unsubscribe = hub.subscribe((event) => {
        safeEnqueue(sse(event.type, event.payload));
      });

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
    },
  });
}
