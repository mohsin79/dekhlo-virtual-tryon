import { settleCreditPackOrder } from "@/lib/payments/orders";
import { isActionableSafepayEvent, parseSafepayWebhook } from "@/lib/payments/safepay/parse-webhook";
import { verifySafepayWebhookSignature } from "@/lib/payments/safepay/signature";
import type { CreditPackOrder, GrantCredits, PaymentLookup } from "@/lib/payments/types";

const DEFAULT_MAX_BODY_BYTES = 65_536;

export async function handleSafepayWebhook(input: {
  rawBody: string;
  signatureHeader: string | null;
  webhookSecret: string;
  maxBodyBytes?: number;
  findOrderByTracker: (tracker: string) => Promise<CreditPackOrder | null>;
  lookupPayment: (order: CreditPackOrder) => Promise<PaymentLookup>;
  grantCredits: GrantCredits;
  saveOrder: (order: CreditPackOrder) => Promise<void>;
}): Promise<{ status: number; granted: boolean }> {
  const maxBodyBytes = input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (Buffer.byteLength(input.rawBody, "utf8") > maxBodyBytes) {
    return { status: 413, granted: false };
  }

  if (
    !verifySafepayWebhookSignature(input.rawBody, input.signatureHeader, input.webhookSecret)
  ) {
    return { status: 401, granted: false };
  }

  const event = parseSafepayWebhook(input.rawBody);

  if (!event) {
    return { status: 400, granted: false };
  }

  if (!event.tracker || !isActionableSafepayEvent(event.eventType)) {
    return { status: 200, granted: false };
  }

  const order = await input.findOrderByTracker(event.tracker);

  if (!order) {
    return { status: 200, granted: false };
  }

  let lookup: PaymentLookup;

  try {
    lookup = await input.lookupPayment(order);
  } catch {
    return { status: 500, granted: false };
  }

  const settled = await settleCreditPackOrder(order, lookup, {
    grantCredits: input.grantCredits,
    saveOrder: input.saveOrder,
  });

  return { status: 200, granted: settled.granted };
}
