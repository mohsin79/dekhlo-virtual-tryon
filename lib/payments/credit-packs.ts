/**
 * Try-on credit packs sold to Pakistani merchants through Safepay.
 * List price is Rs 200 per credit. Growth is Rs 195 per credit and Studio is Rs 190.
 * Amounts are paisa (Rs 2,000 = 200_000).
 */

export const CREDIT_PACK_PENDING_LIMIT = 5;

/** Rs 200, in paisa. Larger packs are priced below this rate. */
export const CREDIT_LIST_PRICE_PAISA_PER_CREDIT = 20_000;

export const CREDIT_PACKS = [
  {
    id: "starter",
    name: "Starter",
    credits: 10,
    amountPaisa: 200_000,
  },
  {
    id: "growth",
    name: "Growth",
    credits: 25,
    amountPaisa: 487_500,
  },
  {
    id: "studio",
    name: "Studio",
    credits: 100,
    amountPaisa: 1_900_000,
  },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number];
export type CreditPackId = CreditPack["id"];

export function getCreditPack(packId: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === packId) ?? null;
}

export const CREDIT_PACKS_VOLUME_NOTE = "Bigger packs cost less per try-on.";

export function creditPackPricing(pack: Pick<CreditPack, "credits" | "amountPaisa">): {
  perCreditPaisa: number;
  discountPercent: number;
  savingsPaisa: number;
} {
  const perCreditPaisa = pack.amountPaisa / pack.credits;
  const listPaisa = pack.credits * CREDIT_LIST_PRICE_PAISA_PER_CREDIT;
  const savingsPaisa = listPaisa - pack.amountPaisa;
  const discountTenths = Math.round((savingsPaisa * 1000) / listPaisa);

  return { perCreditPaisa, discountPercent: discountTenths / 10, savingsPaisa };
}

function formatDiscountPercent(discountPercent: number): string {
  const tenths = Math.round(discountPercent * 10);
  const whole = Math.trunc(tenths / 10);
  const fraction = Math.abs(tenths % 10);

  return fraction === 0 ? String(whole) : `${whole}.${fraction}`;
}

export function formatPkrFromPaisa(amountPaisa: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(amountPaisa / 100);
}

export function formatPerTryOnPrice(pack: CreditPack): string {
  const { perCreditPaisa } = creditPackPricing(pack);
  return `${formatPkrFromPaisa(perCreditPaisa)} per try-on`;
}

export function creditPackSavingsLabel(
  pack: CreditPack,
): { amount: string; percent: string } | null {
  const { discountPercent, savingsPaisa } = creditPackPricing(pack);

  if (savingsPaisa <= 0) {
    return null;
  }

  return {
    amount: `Save ${formatPkrFromPaisa(savingsPaisa)}`,
    percent: `${formatDiscountPercent(discountPercent)}% off`,
  };
}

export function creditPackIdempotencyKey(orderId: string): string {
  return `credit-pack:${orderId}`;
}
