/**
 * Supabase readiness probe.
 *
 * This must prove the hosted Supabase service is actually reachable. The previous
 * implementation called `auth.getSession()`, which with `persistSession: false` and no
 * stored session resolves from local state and performs no network I/O at all — it
 * returned `error: null` against a refused connection and a nonexistent domain, so the
 * endpoint reported healthy during a total outage.
 *
 * The probe therefore exercises the database/PostgREST path instead.
 */

/**
 * `public.brands` is created by the first Phase 2 tenant migration and is never dropped, so it is
 * guaranteed present in every environment. Only the `id` column of at most one row is requested,
 * and the row is discarded — the probe returns a boolean and never surfaces table contents.
 *
 * A `head: true` variant was tried first and rejected: PostgREST answers HTTP HEAD with an empty
 * body, which postgrest-js surfaces as an empty-message error under Next's patched fetch, so a
 * reachable database was reported unhealthy.
 */
export const HEALTH_PROBE_TABLE = "brands";

/**
 * Bounds a provider outage. postgrest-js retries idempotent requests on network errors
 * with exponential backoff, so this abort signal — not the retry budget — is what caps
 * total probe time. Unrelated to the Upstash rate-limit timeout.
 */
export const HEALTH_PROBE_TIMEOUT_MS = 5000;

/** The narrow slice of the Supabase client this probe needs, so tests can inject a fake. */
export type ReadinessProbeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => {
        abortSignal: (signal: AbortSignal) => PromiseLike<{ error: unknown }>;
      };
    };
  };
};

/**
 * Resolves true only when Supabase answered successfully.
 *
 * A successful query returning zero rows is healthy: the probe proves reachability, not
 * the presence of data. Any provider error, network failure, DNS failure or timeout is
 * unhealthy, and the reason is deliberately discarded rather than returned to the caller.
 */
export async function probeSupabaseReadiness(
  client: ReadinessProbeClient,
  timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const { error } = await client
      .from(HEALTH_PROBE_TABLE)
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(timeoutMs));

    return !error;
  } catch {
    return false;
  }
}

/**
 * The admin client is imported dynamically so this module carries no static `server-only`
 * dependency and the probe logic above stays unit-testable. A missing secret key makes
 * client construction throw, which is correctly reported as unhealthy.
 */
export async function verifySupabaseConnection(): Promise<boolean> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");

    return await probeSupabaseReadiness(createAdminClient() as unknown as ReadinessProbeClient);
  } catch {
    return false;
  }
}
