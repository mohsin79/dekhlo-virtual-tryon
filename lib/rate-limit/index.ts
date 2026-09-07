import "server-only";

import { getRateLimitHashSecret } from "@/lib/env";
import {
  allowedDecision,
  classifyUpstashResponse,
  limitedDecision,
  RATE_LIMIT_UNAVAILABLE,
  type RateLimitDecision,
} from "@/lib/rate-limit/decision";
import { hashRateLimitIdentifier } from "@/lib/rate-limit/identifier-hash";
import { hashLeadRateLimitIp } from "@/lib/rate-limit/lead-ip-hash";

export type { RateLimitDecision, RateLimitOutcome } from "@/lib/rate-limit/decision";

/**
 * Explicit provider timeout. @upstash/ratelimit defaults to 5000 ms and, on timeout,
 * resolves with `success: true` and `reason: "timeout"`. We shorten the wait and classify
 * that response as unavailable rather than allowed.
 */
export const UPSTASH_LIMIT_TIMEOUT_MS = 2000;

/** Platform credit mutations share one bucket across grant and revoke. */
export const PLATFORM_CREDIT_MUTATION_LIMIT = 30;
export const PLATFORM_CREDIT_MUTATION_WINDOW = "1 m" as const;
export const PLATFORM_CREDIT_ACTOR_NAMESPACE = "platform-credit-actor";

type RateLimiter = {
  limit: (identifier: string) => Promise<RateLimitDecision>;
};

type MemoryEntry = {
  count: number;
  resetAt: number;
};

const memoryBuckets = new Map<string, MemoryEntry>();

function createMemoryLimiter(max: number, windowMs: number, name: string): RateLimiter {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[rate-limit] Using in-memory limiter for ${name}. Configure Upstash for production.`);
  }

  return {
    async limit(identifier: string) {
      const now = Date.now();
      const key = `${name}:${identifier}`;
      const current = memoryBuckets.get(key);

      if (!current || current.resetAt <= now) {
        memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return allowedDecision(max, max - 1);
      }

      if (current.count >= max) {
        return limitedDecision(max, 0);
      }

      current.count += 1;
      memoryBuckets.set(key, current);
      return allowedDecision(max, max - current.count);
    },
  };
}

type LimitWindow = `${number} s` | `${number} m` | `${number} h` | `${number} d`;

function windowToMs(window: LimitWindow): number {
  const value = Number.parseInt(window, 10);

  if (window.endsWith(" s")) return value * 1000;
  if (window.endsWith(" m")) return value * 60_000;
  if (window.endsWith(" h")) return value * 3_600_000;
  return value * 86_400_000;
}

async function createUpstashLimiter(
  max: number,
  window: LimitWindow,
  prefix: string,
): Promise<RateLimiter> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // Production must never silently downgrade to a per-process limiter. Throwing here is
    // converted into an "unavailable" verdict by the caller, which fails closed.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Rate limit infrastructure is unavailable.");
    }

    return createMemoryLimiter(max, windowToMs(window), prefix);
  }

  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");

  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(max, window),
    prefix,
    analytics: false,
    timeout: UPSTASH_LIMIT_TIMEOUT_MS,
  });

  return {
    async limit(identifier: string) {
      return classifyUpstashResponse(await ratelimit.limit(identifier));
    },
  };
}

/**
 * Lazily builds a limiter once and evaluates identifiers against it.
 *
 * Any initialization or provider failure becomes an "unavailable" verdict instead of an
 * unhandled rejection, and the memoized promise is cleared so a later request can retry
 * rather than inheriting a permanently rejected promise.
 */
function createLazyLimiter(factory: () => Promise<RateLimiter>) {
  let limiterPromise: Promise<RateLimiter> | null = null;

  return async function evaluate(identifier: string): Promise<RateLimitDecision> {
    try {
      limiterPromise ??= factory();
      const limiter = await limiterPromise;
      return await limiter.limit(identifier);
    } catch {
      limiterPromise = null;
      return RATE_LIMIT_UNAVAILABLE;
    }
  };
}

const leadSessionLimiter = createLazyLimiter(() => createUpstashLimiter(5, "1 h", "lead-session"));
const leadIpLimiter = createLazyLimiter(() => createUpstashLimiter(30, "1 h", "lead-ip"));
const leadGlobalLimiter = createLazyLimiter(() => createUpstashLimiter(200, "1 h", "lead-global"));
const sessionCreateLimiter = createLazyLimiter(() =>
  createUpstashLimiter(20, "1 h", "tryon-session-create"),
);
const demoIpLimiter = createLazyLimiter(() => createUpstashLimiter(30, "1 h", "demo-ip"));
const demoCookieLimiter = createLazyLimiter(() => createUpstashLimiter(5, "1 d", "demo-cookie"));
const demoGlobalLimiter = createLazyLimiter(() => {
  const cap = Number.parseInt(process.env.DEMO_DAILY_CAP ?? "500", 10);
  return createUpstashLimiter(cap, "1 d", "demo-global");
});
const platformCreditActorLimiter = createLazyLimiter(() =>
  createUpstashLimiter(
    PLATFORM_CREDIT_MUTATION_LIMIT,
    PLATFORM_CREDIT_MUTATION_WINDOW,
    PLATFORM_CREDIT_ACTOR_NAMESPACE,
  ),
);

export async function limitLeadCaptureBySession(sessionId: string): Promise<RateLimitDecision> {
  return leadSessionLimiter(sessionId);
}

export async function limitLeadCaptureByIp(request: Request): Promise<RateLimitDecision> {
  let hashed: string;

  try {
    // Only the hash reaches the limiter store; the raw IP stays a local value.
    hashed = hashLeadRateLimitIp(getClientIp(request), getRateLimitHashSecret());
  } catch {
    return RATE_LIMIT_UNAVAILABLE;
  }

  return leadIpLimiter(hashed);
}

export async function limitLeadCaptureGlobal(): Promise<RateLimitDecision> {
  return leadGlobalLimiter("global");
}

export async function limitSessionCreation(ip: string): Promise<RateLimitDecision> {
  return sessionCreateLimiter(ip);
}

export async function limitDemoByIp(ip: string): Promise<RateLimitDecision> {
  return demoIpLimiter(ip);
}

export async function limitDemoByCookie(cookieId: string): Promise<RateLimitDecision> {
  return demoCookieLimiter(cookieId);
}

export async function limitDemoGlobal(): Promise<RateLimitDecision> {
  return demoGlobalLimiter("global");
}

/**
 * Defence-in-depth limiter for platform credit mutations, shared by grant and revoke so the
 * two operations cannot together exceed the intended per-actor budget.
 *
 * One unit is consumed per authenticated platform-admin mutation request that reaches the
 * limiter — that is, per HTTP attempt before validation and before any credit RPC — so a
 * looping or failing client cannot flood the database. Authorization runs first, so
 * unauthenticated and non-platform-admin traffic never consumes an actor bucket.
 */
export async function limitPlatformCreditMutation(
  actorUserId: string,
): Promise<RateLimitDecision> {
  let hashed: string;

  try {
    // The raw Supabase user id is never used as a limiter key and is never logged.
    hashed = hashRateLimitIdentifier(
      PLATFORM_CREDIT_ACTOR_NAMESPACE,
      actorUserId,
      getRateLimitHashSecret(),
    );
  } catch {
    return RATE_LIMIT_UNAVAILABLE;
  }

  return platformCreditActorLimiter(hashed);
}

export function isDemoKillSwitchEnabled(): boolean {
  return process.env.DEMO_KILL_SWITCH === "true";
}

/**
 * Resolves the client IP for IP-scoped limiters.
 *
 * Trusted-proxy assumption: this trusts the first X-Forwarded-For entry because the
 * production reverse proxy is expected to overwrite or sanitize that header. Not all
 * proxies do — a proxy that appends instead would let a client prepend an arbitrary value
 * and rotate IP-scoped buckets. If the deployment moves away from that proxy model, this
 * header trust policy must be reviewed before relying on IP-scoped limits.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}
