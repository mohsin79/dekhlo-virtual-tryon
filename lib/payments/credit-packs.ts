/**
 * Placeholder credit packs for Pakistani merchants.
 * Prices are not a live tariff. Replace them before charging real brands.
 */
export const CREDIT_PACK_PRICE_NOTE =
  "Placeholder price. These packs are examples until real PKR prices are set.";

export const CREDIT_PACK_PENDING_LIMIT = 5;

export const CREDIT_PACKS = [
  {
    id: "starter",
    name: "Starter",
    credits: 25,
    amountPaisa: 250_000,
  },
  {
    id: "growth",
    name: "Growth",
    credits: 100,
    amountPaisa: 800_000,
  },
  {
    id: "studio",
    name: "Studio",
    credits: 400,
    amountPaisa: 2_500_000,
  },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number];
export type CreditPackId = CreditPack["id"];

export function getCreditPack(packId: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === packId) ?? null;
}

export function formatPkrFromPaisa(amountPaisa: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(amountPaisa / 100);
}

export function creditPackIdempotencyKey(orderId: string): string {
  return `credit-pack:${orderId}`;
}
