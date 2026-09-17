import {
  createSolanaConnection,
  decodeLaunch,
  looksLikeCreate,
  PUMP_PROGRAM_ID,
} from "@/lib/pump";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(request: Request) {
  const connection = createSolanaConnection();

  let subscriptionId: number | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    if (subscriptionId !== null) {
      await connection.removeOnLogsListener(subscriptionId).catch(() => undefined);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (!closed) controller.enqueue(chunk);
      };

      safeEnqueue(
        sse("status", {
          state: "connecting",
          program: PUMP_PROGRAM_ID.toBase58(),
        }),
      );

      try {
        subscriptionId = await connection.onLogs(
          PUMP_PROGRAM_ID,
          async (notification, context) => {
            if (notification.err || !looksLikeCreate(notification.logs)) return;

            // RPC websocket and transaction endpoints can briefly race each other.
            // A short retry avoids losing a legitimate launch during that window.
            for (let attempt = 0; attempt < 3; attempt += 1) {
              try {
                const launch = await decodeLaunch(
                  connection,
                  notification.signature,
                  context.slot,
                );

                if (launch) safeEnqueue(sse("launch", launch));
                return;
              } catch (error) {
                if (attempt < 2) {
                  await sleep(300 * (attempt + 1));
                  continue;
                }

                console.error(
                  "[trenchscan] failed to decode launch",
                  notification.signature,
                  error,
                );
              }
            }
          },
          "confirmed",
        );

        safeEnqueue(
          sse("status", {
            state: "live",
            program: PUMP_PROGRAM_ID.toBase58(),
          }),
        );

        keepAlive = setInterval(() => {
          safeEnqueue(encoder.encode(": keepalive\n\n"));
        }, 15_000);
      } catch (error) {
        console.error("[trenchscan] websocket subscription failed", error);
        safeEnqueue(
          sse("status", {
            state: "error",
            message: "Could not subscribe to Solana. Check the RPC configuration.",
          }),
        );
        closed = true;
        controller.close();
      }
    },
    cancel() {
      return cleanup();
    },
  });

  request.signal.addEventListener(
    "abort",
    () => {
      void cleanup();
    },
    { once: true },
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
