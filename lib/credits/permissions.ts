import type { Database } from "@/lib/supabase/database.types";

export type BrandRole = Database["public"]["Enums"]["brand_role"];

const CREDIT_VIEWER_ROLES: BrandRole[] = ["owner", "admin", "analyst"];
const CREDIT_PURCHASE_ROLES: BrandRole[] = ["owner", "admin"];

export function canViewCredits(role: BrandRole | null | undefined): boolean {
  return role != null && CREDIT_VIEWER_ROLES.includes(role);
}

export function canPurchaseCredits(role: BrandRole | null | undefined): boolean {
  return role != null && CREDIT_PURCHASE_ROLES.includes(role);
}
