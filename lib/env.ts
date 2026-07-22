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
