export const MAX_SUPPORTED_TRANSACTION_VERSION = 1;

const DEFAULT_RETRY_DELAYS_MS = [600, 1_200, 2_400, 4_800];

export function isRpcRateLimit(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("429") ||
    message.toLowerCase().includes("too many requests")
  );
}

export async function withRpcRetry<T>(
  operation: () => Promise<T>,
  delaysMs = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRpcRateLimit(error) || attempt >= delaysMs.length) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}
