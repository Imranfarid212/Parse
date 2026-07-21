type NetworkRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  label?: string;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 350;
const DEFAULT_MAX_DELAY_MS = 2_000;
const DEFAULT_JITTER_RATIO = 0.2;

function getNumericProperty(error: unknown, property: string) {
  if (typeof error !== 'object' || error === null || !(property in error)) return null;
  const value = (error as Record<string, unknown>)[property];
  return typeof value === 'number' ? value : null;
}

export function isTransientNetworkError(error: unknown) {
  const status = getNumericProperty(error, 'status');
  if (status === 0 || (status !== null && status >= 500)) return true;

  if (typeof error !== 'object' || error === null || !('message' in error)) return false;
  const message = String((error as { message?: unknown }).message).toLowerCase();

  return (
    message.includes('fetch failed') ||
    message.includes('network connection was lost') ||
    message.includes('network request failed') ||
    message.includes('internal server error') ||
    message.includes('"status":500') ||
    message.includes('"status":502') ||
    message.includes('"status":503') ||
    message.includes('"status":504') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable')
  );
}

function getRetryDelayMs(attemptIndex: number, options: Required<Pick<NetworkRetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio'>>) {
  const exponentialDelay = Math.min(options.baseDelayMs * 2 ** attemptIndex, options.maxDelayMs);
  const jitter = exponentialDelay * options.jitterRatio * Math.random();
  return Math.round(exponentialDelay + jitter);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withNetworkRetry<T>(operation: () => Promise<T>, options: NetworkRetryOptions = {}) {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const retryOptions = {
    baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    jitterRatio: options.jitterRatio ?? DEFAULT_JITTER_RATIO,
  };

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attemptIndex === attempts - 1;
      if (isLastAttempt || !isTransientNetworkError(error)) throw error;

      if (__DEV__) {
        console.warn(`Retrying transient network failure${options.label ? ` in ${options.label}` : ''}.`, error);
      }

      await wait(getRetryDelayMs(attemptIndex, retryOptions));
    }
  }

  throw new Error('Network retry failed unexpectedly.');
}
