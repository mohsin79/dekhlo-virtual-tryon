import { creditPackIdempotencyKey, getCreditPack } from "@/lib/payments/credit-packs";
import type {
  CreditPackOrder,
  GrantCredits,
  PaymentEnvironment,
  PaymentLookup,
} from "@/lib/payments/types";

export class CreditPackCheckoutError extends Error {
  readonly code: "unknown_pack" | "too_many_pending" | "provider_unavailable" | "invalid_tracker";

  constructor(code: CreditPackCheckoutError["code"]) {
    super(code);
    this.name = "CreditPackCheckoutError";
    this.code = code;
  }
}

const TRACKER_PATTERN = /^track_[A-Za-z0-9-]{8,80}$/;

export function isSafepayTracker(value: string): boolean {
  return TRACKER_PATTERN.test(value);
}

export function buildPendingCreditPackOrder(input: {
  orderId: string;
  brandId: string;
  packId: string;
  provider: string;
  providerEnvironment: PaymentEnvironment;
}): CreditPackOrder {
  const pack = getCreditPack(input.packId);

  if (!pack) {
    throw new CreditPackCheckoutError("unknown_pack");
  }

  return {
    id: input.orderId,
    brandId: input.brandId,
    packId: pack.id,
    credits: pack.credits,
    amountPaisa: pack.amountPaisa,
    currency: "PKR",
    provider: input.provider,
    providerEnvironment: input.providerEnvironment,
    status: "pending",
    providerTracker: null,
    creditIdempotencyKey: creditPackIdempotencyKey(input.orderId),
    grantedTransactionId: null,
    failureCode: null,
  };
}

export async function createCreditPackCheckout(input: {
  orderId: string;
  brandId: string;
  packId: string;
  provider: string;
  providerEnvironment: PaymentEnvironment;
  pendingCount: number;
  pendingLimit: number;
  successUrl: string;
  cancelUrl: string;
  insertOrder: (order: CreditPackOrder) => Promise<void>;
  attachTracker: (orderId: string, tracker: string) => Promise<void>;
  markFailed: (orderId: string, failureCode: string) => Promise<void>;
  createCheckout: (input: {
    order: CreditPackOrder;
    successUrl: string;
    cancelUrl: string;
  }) => Promise<{ tracker: string; checkoutUrl: string }>;
}): Promise<{ order: CreditPackOrder; checkoutUrl: string }> {
  if (input.pendingCount >= input.pendingLimit) {
    throw new CreditPackCheckoutError("too_many_pending");
  }

  const order = buildPendingCreditPackOrder(input);
  await input.insertOrder(order);

  let checkout: { tracker: string; checkoutUrl: string };

  try {
    checkout = await input.createCheckout({
      order,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
  } catch {
    await input.markFailed(order.id, "checkout_failed");
    throw new CreditPackCheckoutError("provider_unavailable");
  }

  if (!isSafepayTracker(checkout.tracker) || !checkout.checkoutUrl) {
    await input.markFailed(order.id, "invalid_tracker");
    throw new CreditPackCheckoutError("invalid_tracker");
  }

  try {
    await input.attachTracker(order.id, checkout.tracker);
  } catch {
    await input.markFailed(order.id, "checkout_failed");
    throw new CreditPackCheckoutError("provider_unavailable");
  }

  return {
    order: { ...order, providerTracker: checkout.tracker },
    checkoutUrl: checkout.checkoutUrl,
  };
}

export type SettleResult = {
  order: CreditPackOrder;
  granted: boolean;
};

function paidOrder(order: CreditPackOrder, transactionId: string): CreditPackOrder {
  return {
    ...order,
    status: "paid",
    grantedTransactionId: transactionId,
    failureCode: null,
  };
}

function failedOrder(order: CreditPackOrder, failureCode: string): CreditPackOrder {
  return {
    ...order,
    status: "failed",
    failureCode,
  };
}

/**
 * Apply a server-side payment lookup to an order.
 * A paid order is never granted again. A lookup that is not paid never grants.
 */
export async function settleCreditPackOrder(
  order: CreditPackOrder,
  lookup: PaymentLookup,
  deps: {
    grantCredits: GrantCredits;
    saveOrder: (order: CreditPackOrder) => Promise<void>;
  },
  options: { abandonIfPending?: boolean } = {},
): Promise<SettleResult> {
  if (order.status === "paid") {
    return { order, granted: false };
  }

  if (!order.providerTracker || lookup.tracker !== order.providerTracker) {
    const next = failedOrder(order, "tracker_mismatch");
    await deps.saveOrder(next);
    return { order: next, granted: false };
  }

  if (lookup.status === "paid") {
    if (lookup.currency !== "PKR" || lookup.amountPaisa !== order.amountPaisa) {
      const next = failedOrder(order, "amount_mismatch");
      await deps.saveOrder(next);
      return { order: next, granted: false };
    }

    const grant = await deps.grantCredits(order);
    const next = paidOrder(order, grant.transactionId);
    await deps.saveOrder(next);
    return { order: next, granted: grant.wasCreated };
  }

  if (lookup.status === "failed") {
    const next = failedOrder(order, lookup.failureCode);
    await deps.saveOrder(next);
    return { order: next, granted: false };
  }

  if (lookup.status === "cancelled" || (lookup.status === "pending" && options.abandonIfPending)) {
    const next: CreditPackOrder = {
      ...order,
      status: "cancelled",
      failureCode: null,
    };
    await deps.saveOrder(next);
    return { order: next, granted: false };
  }

  return { order, granted: false };
}
