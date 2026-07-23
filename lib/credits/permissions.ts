import type { Database } from "@/lib/supabase/database.types";

export type BrandRole = Database["public"]["Enums"]["brand_role"];

const CREDIT_VIEWER_ROLES: BrandRole[] = ["owner", "admin", "analyst"];

export function canViewCredits(role: BrandRole | null | undefined): boolean {
  return role != null && CREDIT_VIEWER_ROLES.includes(role);
}
