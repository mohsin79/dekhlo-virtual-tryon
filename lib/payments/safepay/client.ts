import type { SafepayConfig } from "@/lib/payments/safepay/config";
import type { CreatedCheckout, PaymentLookup, PaymentProvider } from "@/lib/payments/types";

const REQUEST_TIMEOUT_MS = 15_000;

export class SafepayRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Safepay request failed.");
    this.name = "SafepayRequestError";
    this.status = status;
  }
}

type FetchLike = typeof fetch;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readTrackerToken(payload: unknown): string | null {
  const root = readRecord(payload);
  const data = readRecord(root?.data) ?? root;
  const tracker = readRecord(data?.tracker);
  const token = tracker?.token;

  return typeof token === "string" ? token : null;
}

function readPassportToken(payload: unknown): string | null {
  const root = readRecord(payload);
  const data = root?.data;

  if (typeof data === "string" && data.trim()) {
    return data.trim();
  }

  const dataRecord = readRecord(data);
  const token = dataRecord?.token ?? dataRecord?.data;

  return typeof token === "string" && token.trim() ? token.trim() : null;
}

function readMoney(value: unknown): { currency: string; amount: number } | null {
  const record = readRecord(value);

  if (!record || typeof record.currency !== "string" || typeof record.amount !== "number") {
    return null;
  }

  if (!Number.isInteger(record.amount)) {
    return null;
  }

  return { currency: record.currency, amount: record.amount };
}

export function interpretTrackerPayload(
  payload: unknown,
  requestedTracker: string,
  expectedMerchantApiKey?: string,
): PaymentLookup {
  const root = readRecord(payload);
  const data = readRecord(root?.data) ?? root;
  const tracker = readRecord(data?.tracker);
  const token = typeof tracker?.token === "string" ? tracker.token : requestedTracker;
  const state = typeof tracker?.state === "string" ? tracker.state : "";
  const client = typeof tracker?.client === "string" ? tracker.client : null;

  if (
    expectedMerchantApiKey &&
    state === "TRACKER_ENDED" &&
    client !== expectedMerchantApiKey
  ) {
    return { status: "failed", tracker: token, failureCode: "merchant_mismatch" };
  }

  if (state === "TRACKER_ENDED") {
    const totals = readRecord(tracker?.purchase_totals);
    const quote = readMoney(totals?.quote_amount) ?? readMoney(totals?.base_amount);

    if (!quote) {
      return { status: "failed", tracker: token, failureCode: "amount_unreadable" };
    }

    return {
      status: "paid",
      tracker: token,
      amountPaisa: quote.amount,
      currency: quote.currency,
    };
  }

  if (
    state === "TRACKER_STARTED" ||
    state === "TRACKER_ENROLLED" ||
    state === "TRACKER_AUTHORIZED"
  ) {
    return { status: "pending", tracker: token };
  }

  if (state === "TRACKER_CANCELLED") {
    return { status: "cancelled", tracker: token };
  }

  if (
    state === "TRACKER_EXPIRED" ||
    state === "TRACKER_REVERSED" ||
    state === "TRACKER_VOIDED" ||
    state === "TRACKER_REFUNDED" ||
    state === "TRACKER_PARTIAL_REFUND" ||
    state === "TRACKER_DISPUTED"
  ) {
    return { status: "failed", tracker: token, failureCode: state.toLowerCase() };
  }

  return { status: "pending", tracker: token };
}

export function buildSafepayCheckoutUrl(
  config: SafepayConfig,
  input: { tracker: string; tbt: string; successUrl: string; cancelUrl: string; orderId: string },
): string {
  const params = new URLSearchParams({
    environment: config.environment,
    tracker: input.tracker,
    tbt: input.tbt,
    source: "hosted",
    order_id: input.orderId,
    redirect_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  return `${config.checkoutBaseUrl}?${params.toString()}`;
}

async function safepayFetch(
  config: SafepayConfig,
  fetchImpl: FetchLike,
  path: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${config.apiHost}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-SFPY-MERCHANT-SECRET": config.secretKey,
      },
      body: init.body,
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new SafepayRequestError(response.status);
    }

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SafepayRequestError(response.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

export function createSafepayProvider(
  config: SafepayConfig,
  fetchImpl: FetchLike = fetch,
): PaymentProvider {
  return {
    id: "safepay",
    async createCheckout(input): Promise<CreatedCheckout> {
      const session = await safepayFetch(config, fetchImpl, "/order/payments/v3/", {
        method: "POST",
        body: JSON.stringify({
          merchant_api_key: config.apiKey,
          intent: config.intent,
          mode: "payment",
          entry_mode: "raw",
          currency: "PKR",
          amount: input.order.amountPaisa,
          include_fees: false,
          metadata: {
            order_id: input.order.id,
            brand_id: input.order.brandId,
            pack_id: input.order.packId,
          },
        }),
      });
      const tracker = readTrackerToken(session);

      if (!tracker) {
        throw new SafepayRequestError(502);
      }

      const passport = await safepayFetch(config, fetchImpl, "/client/passport/v1/token", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const tbt = readPassportToken(passport);

      if (!tbt) {
        throw new SafepayRequestError(502);
      }

      return {
        tracker,
        checkoutUrl: buildSafepayCheckoutUrl(config, {
          tracker,
          tbt,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          orderId: input.order.id,
        }),
      };
    },
    async lookupPayment(tracker: string): Promise<PaymentLookup> {
      const payload = await safepayFetch(
        config,
        fetchImpl,
        `/reporter/api/v1/payments/${encodeURIComponent(tracker)}`,
        { method: "GET" },
      );

      return interpretTrackerPayload(payload, tracker, config.apiKey);
    },
  };
}
