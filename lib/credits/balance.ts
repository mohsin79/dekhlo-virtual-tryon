export type CreditBalanceSnapshot = {
  brandId: string;
  grantedCredits: number;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number;
  updatedAt: string;
};

export function calculateAvailableCredits(
  grantedCredits: number,
  reservedCredits: number,
  consumedCredits: number,
): number {
  return grantedCredits - reservedCredits - consumedCredits;
}

export function toCreditBalanceSnapshot(row: {
  brand_id: string;
  granted_credits: number;
  reserved_credits: number;
  consumed_credits: number;
  updated_at: string;
}): CreditBalanceSnapshot {
  return {
    brandId: row.brand_id,
    grantedCredits: row.granted_credits,
    reservedCredits: row.reserved_credits,
    consumedCredits: row.consumed_credits,
    availableCredits: calculateAvailableCredits(
      row.granted_credits,
      row.reserved_credits,
      row.consumed_credits,
    ),
    updatedAt: row.updated_at,
  };
}
