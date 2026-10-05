export type PaymentEnvironment = "sandbox" | "production";

export type CreditPackOrderStatus = "pending" | "paid" | "failed" | "cancelled";

export type CreditPackOrder = {
  id: string;
  brandId: string;
  packId: string;
  credits: number;
  amountPaisa: number;
  currency: "PKR";
  provider: string;
  providerEnvironment: PaymentEnvironment;
  status: CreditPackOrderStatus;
  providerTracker: string | null;
  creditIdempotencyKey: string;
  grantedTransactionId: string | null;
  failureCode: string | null;
};

export type PaymentLookup =
  | {
      status: "paid";
      tracker: string;
      amountPaisa: number;
      currency: string;
    }
  | {
      status: "pending";
      tracker: string;
    }
  | {
      status: "failed";
      tracker: string;
      failureCode: string;
    }
  | {
      status: "cancelled";
      tracker: string;
    };

export type CreatedCheckout = {
  tracker: string;
  checkoutUrl: string;
};

export type GrantCreditsResult = {
  transactionId: string;
  wasCreated: boolean;
};

export type GrantCredits = (order: CreditPackOrder) => Promise<GrantCreditsResult>;

/**
 * Gateway-agnostic payment operations. Safepay is the first implementation.
 * Another Pakistani gateway can implement the same three operations later.
 */
export interface PaymentProvider {
  readonly id: string;
  createCheckout(input: {
    order: CreditPackOrder;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CreatedCheckout>;
  lookupPayment(tracker: string): Promise<PaymentLookup>;
}
