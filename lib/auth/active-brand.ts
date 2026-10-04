export const ACTIVE_BRAND_COOKIE = "dekhlo_active_brand";

/**
 * Picks the merchant's active brand from memberships already authorized by RLS.
 * An unknown or stale cookie never selects a brand the user does not belong to.
 */
export function selectActiveBrandMembership<T extends { brandId: string }>(
  memberships: readonly T[],
  activeBrandId: string | null | undefined,
): T | null {
  if (memberships.length === 0) {
    return null;
  }

  if (activeBrandId) {
    const match = memberships.find((membership) => membership.brandId === activeBrandId);

    if (match) {
      return match;
    }
  }

  return memberships[0] ?? null;
}
