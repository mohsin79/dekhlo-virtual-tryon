import type { Database } from "@/lib/supabase/database.types";

type PlatformRole = Database["public"]["Enums"]["platform_role"];

export function isPlatformAdminProfile(profile: {
  platform_role: PlatformRole | null;
}): boolean {
  return profile.platform_role === "platform_admin";
}
