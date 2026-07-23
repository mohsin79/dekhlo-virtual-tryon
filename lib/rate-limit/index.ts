import "server-only";

type RateLimitResult = {
  success: boolean;
  limit?: number;
  remaining?: number;
};

type RateLimiter = {
  limit: (identifier: string) => Promise<RateLimitResult>;
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
        return { success: true, limit: max, remaining: max - 1 };
      }

      if (current.count >= max) {
        return { success: false, limit: max, remaining: 0 };
      }

      current.count += 1;
      memoryBuckets.set(key, current);
      return { success: true, limit: max, remaining: max - current.count };
    },
  };
}

async function createUpstashLimiter(
  max: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
  prefix: string,
): Promise<RateLimiter> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Rate limit infrastructure is unavailable.");
    }

    const windowMs =
      window.endsWith(" s") ? Number.parseInt(window, 10) * 1000 :
      window.endsWith(" m") ? Number.parseInt(window, 10) * 60_000 :
      window.endsWith(" h") ? Number.parseInt(window, 10) * 3_600_000 :
      Number.parseInt(window, 10) * 86_400_000;

    return createMemoryLimiter(max, windowMs, prefix);
  }

  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");

  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(max, window),
    prefix,
    analytics: false,
  });

  return {
    async limit(identifier: string) {
      const result = await ratelimit.limit(identifier);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
      };
    },
  };
}

let sessionCreateLimiterPromise: Promise<RateLimiter> | null = null;
let demoIpLimiterPromise: Promise<RateLimiter> | null = null;
let demoCookieLimiterPromise: Promise<RateLimiter> | null = null;
let demoGlobalLimiterPromise: Promise<RateLimiter> | null = null;

export async function limitSessionCreation(ip: string): Promise<RateLimitResult> {
  sessionCreateLimiterPromise ??= createUpstashLimiter(20, "1 h", "tryon-session-create");
  return sessionCreateLimiterPromise.then((limiter) => limiter.limit(ip));
}

export async function limitDemoByIp(ip: string): Promise<RateLimitResult> {
  demoIpLimiterPromise ??= createUpstashLimiter(30, "1 h", "demo-ip");
  return demoIpLimiterPromise.then((limiter) => limiter.limit(ip));
}

export async function limitDemoByCookie(cookieId: string): Promise<RateLimitResult> {
  demoCookieLimiterPromise ??= createUpstashLimiter(5, "1 d", "demo-cookie");
  return demoCookieLimiterPromise.then((limiter) => limiter.limit(cookieId));
}

export async function limitDemoGlobal(): Promise<RateLimitResult> {
  const cap = Number.parseInt(process.env.DEMO_DAILY_CAP ?? "500", 10);
  demoGlobalLimiterPromise ??= createUpstashLimiter(cap, "1 d", "demo-global");
  return demoGlobalLimiterPromise.then((limiter) => limiter.limit("global"));
}

export function isDemoKillSwitchEnabled(): boolean {
  return process.env.DEMO_KILL_SWITCH === "true";
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}
