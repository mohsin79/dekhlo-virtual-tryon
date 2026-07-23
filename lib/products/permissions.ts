import type { Database } from "@/lib/supabase/database.types";

export type BrandRole = Database["public"]["Enums"]["brand_role"];

const PRODUCT_MANAGER_ROLES: BrandRole[] = ["owner", "admin", "editor"];

export function canManageProducts(role: BrandRole | null | undefined): boolean {
  return role != null && PRODUCT_MANAGER_ROLES.includes(role);
}

export function isReadOnlyProductRole(role: BrandRole | null | undefined): boolean {
  return role === "analyst";
}
