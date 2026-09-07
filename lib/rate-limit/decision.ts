/**
 * Rate-limit verdicts are three-valued on purpose.
 *
 * A boolean `success` cannot distinguish "the provider evaluated this request and it is
 * within the limit" from "the provider never evaluated this request". The installed
 * @upstash/ratelimit resolves with `success: true` and `reason: "timeout"` when its
 * internal timeout wins the race, so treating that boolean as authoritative fails open.
 */
export type RateLimitOutcome = "allowed" | "limited" | "unavailable";

export type RateLimitDecision = {
  outcome: RateLimitOutcome;
  limit?: number;
  remaining?: number;
};

/** Provider could not be consulted, or its answer could not be trusted. Callers fail closed. */
export const RATE_LIMIT_UNAVAILABLE: RateLimitDecision = { outcome: "unavailable" };

export function allowedDecision(limit?: number, remaining?: number): RateLimitDecision {
  return { outcome: "allowed", limit, remaining };
}

export function limitedDecision(limit?: number, remaining?: number): RateLimitDecision {
  return { outcome: "limited", limit, remaining };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Classifies a raw @upstash/ratelimit response without trusting permissive defaults.
 *
 * `reason: "timeout"` means the provider never answered, so it is unavailable regardless
 * of `success`. The other documented reasons ("cacheBlock", "denyList") accompany a real
 * denial and are ordinary rate limiting.
 */
export function classifyUpstashResponse(response: unknown): RateLimitDecision {
  if (typeof response !== "object" || response === null) {
    return RATE_LIMIT_UNAVAILABLE;
  }

  const candidate = response as {
    success?: unknown;
    reason?: unknown;
    limit?: unknown;
    remaining?: unknown;
  };

  if (candidate.reason === "timeout") {
    return RATE_LIMIT_UNAVAILABLE;
  }

  if (typeof candidate.success !== "boolean") {
    return RATE_LIMIT_UNAVAILABLE;
  }

  const limit = finiteNumber(candidate.limit);
  const remaining = finiteNumber(candidate.remaining);

  return candidate.success ? allowedDecision(limit, remaining) : limitedDecision(limit, remaining);
}

/**
 * Reduces several limiter verdicts to one outcome for a single request.
 *
 * A definite denial wins over an unavailable verdict: both reject the request, and 429 is
 * the more precise answer when at least one limit is known to be exceeded. An empty set
 * means nothing was evaluated, which is unavailable rather than allowed.
 */
export function combineRateLimitDecisions(
  decisions: readonly RateLimitDecision[],
): RateLimitOutcome {
  if (decisions.length === 0) {
    return "unavailable";
  }

  if (decisions.some((decision) => decision.outcome === "limited")) {
    return "limited";
  }

  if (decisions.some((decision) => decision.outcome === "unavailable")) {
    return "unavailable";
  }

  return "allowed";
}
