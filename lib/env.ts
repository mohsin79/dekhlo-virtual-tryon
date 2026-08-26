import { z } from "zod";

const supabaseUrlSchema = z.string().url();

function warnLegacyEnv(modern: string, legacy: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[env] ${legacy} is deprecated; use ${modern} instead.`);
  }
}

export function getSupabaseUrl(): string {
  const parsed = supabaseUrlSchema.safeParse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!parsed.success) {
    throw new Error("Missing or invalid NEXT_PUBLIC_SUPABASE_URL.");
  }
  return parsed.data;
}

export function getSupabasePublishableKey(): string {
  const modern = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (modern) return modern;

  const legacy = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (legacy) {
    warnLegacyEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return legacy;
  }

  throw new Error(
    "Missing Supabase publishable key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export function getSupabaseSecretKey(): string {
  const modern = process.env.SUPABASE_SECRET_KEY?.trim();
  if (modern) return modern;

  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy) {
    warnLegacyEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    return legacy;
  }

  throw new Error("Missing Supabase secret key. Set SUPABASE_SECRET_KEY.");
}

export function getInternalHealthSecret(): string | undefined {
  return process.env.INTERNAL_HEALTH_SECRET?.trim() || undefined;
}

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const parsed = supabaseUrlSchema.safeParse(raw);

  if (parsed.success) {
    return parsed.data.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  throw new Error("Missing or invalid NEXT_PUBLIC_SITE_URL.");
}

type LeadRateLimitEnv = {
  LEAD_RATE_LIMIT_HASH_SECRET?: string;
  NODE_ENV?: string;
};

/** Server-only pepper for hashing client IPs in lead capture rate limits. Never expose publicly. */
export function resolveLeadRateLimitHashSecret(env: LeadRateLimitEnv = process.env): string {
  const value = env.LEAD_RATE_LIMIT_HASH_SECRET?.trim();

  if (value) {
    return value;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("Missing LEAD_RATE_LIMIT_HASH_SECRET.");
  }

  return "dekhlo-lead-dev-only-hash-secret";
}

export function getLeadRateLimitHashSecret(): string {
  return resolveLeadRateLimitHashSecret(process.env);
}

export function getSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || undefined;
}

export function getSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development";
}

export function getSentryRelease(): string | undefined {
  return process.env.SENTRY_RELEASE?.trim() || undefined;
}
