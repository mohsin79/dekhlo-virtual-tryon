import type { Database } from "@/lib/supabase/database.types";

export type BrandRole = Database["public"]["Enums"]["brand_role"];

const LEAD_VIEWER_ROLES: BrandRole[] = ["owner", "admin"];

export function canViewLeads(role: BrandRole | null | undefined): boolean {
  return role != null && LEAD_VIEWER_ROLES.includes(role);
}
