type InngestDevModeEnv = {
  INNGEST_DEV?: string;
  NODE_ENV?: string;
};

/**
 * Dev mode disables Inngest request signature verification, so production must never
 * enter it — an INNGEST_DEV=1 value that leaks into a production environment is ignored.
 */
export function resolveInngestDevMode(env: InngestDevModeEnv = process.env): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }

  return env.INNGEST_DEV === "1";
}

export function isInngestDevMode(): boolean {
  return resolveInngestDevMode(process.env);
}

export function assertInngestEventSendingConfigured(): void {
  if (isInngestDevMode()) {
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    throw new Error("Inngest event configuration is unavailable.");
  }
}

export function getInngestEventKey(): string | undefined {
  return process.env.INNGEST_EVENT_KEY?.trim() || undefined;
}

type InngestTryOnConcurrencyEnv = {
  INNGEST_TRY_ON_CONCURRENCY?: string;
  [key: string]: string | undefined;
};

/**
 * The account-wide concurrency limit `process-try-on-generation` declared before it became
 * configurable. Used whenever INNGEST_TRY_ON_CONCURRENCY is absent or blank.
 */
export const DEFAULT_INNGEST_TRY_ON_CONCURRENCY = 8;

/**
 * Resolves the global concurrency limit for `process-try-on-generation`.
 *
 * Absent or blank falls back to the default. Anything else must be a positive integer
 * literal — no sign, no fraction, no exponent — and an invalid configured value throws
 * rather than falling back, so a misconfigured deployment fails at function registration
 * instead of quietly running with a concurrency nobody chose. No plan-specific ceiling is
 * enforced here: Inngest owns the account maximum and rejects an over-limit sync itself.
 */
export function resolveInngestTryOnConcurrency(
  env: InngestTryOnConcurrencyEnv = process.env,
): number {
  const raw = env.INNGEST_TRY_ON_CONCURRENCY?.trim();

  if (!raw) {
    return DEFAULT_INNGEST_TRY_ON_CONCURRENCY;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error("Invalid INNGEST_TRY_ON_CONCURRENCY: expected a positive integer.");
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid INNGEST_TRY_ON_CONCURRENCY: expected a positive integer.");
  }

  return value;
}

export function getInngestTryOnConcurrency(): number {
  return resolveInngestTryOnConcurrency(process.env);
}
