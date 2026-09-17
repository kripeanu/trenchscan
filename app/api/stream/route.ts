import {
  createPumpSdk,
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
  const pump = createPumpSdk(connection);

  let subscriptionId: number | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

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

            // A confirmed websocket notification should already be RPC-readable,
            // but providers occasionally race their own transaction endpoint.
            // One tiny retry prevents us from dropping a real launch for that reason.
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                const launch = await decodeLaunch(
                  pump,
                  notification.signature,
                  context.slot,
                );

                if (launch) safeEnqueue(sse("launch", launch));
                return;
              } catch (error) {
                if (attempt === 0) {
                  await sleep(350);
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
        controller.close();
        closed = true;
      }
    },
    async cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (subscriptionId !== null) {
        await connection.removeOnLogsListener(subscriptionId).catch(() => undefined);
      }
    },
  });

  request.signal.addEventListener(
    "abort",
    () => {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (subscriptionId !== null) {
        void connection.removeOnLogsListener(subscriptionId).catch(() => undefined);
      }
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
