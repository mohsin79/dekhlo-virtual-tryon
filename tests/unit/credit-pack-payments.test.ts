import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { CREDIT_PACK_PENDING_LIMIT, getCreditPack } from "@/lib/payments/credit-packs";
import { createCreditPackCheckout, settleCreditPackOrder } from "@/lib/payments/orders";
import { resolveSafepayConfig } from "@/lib/payments/safepay/config";
import { createSafepayProvider, interpretTrackerPayload } from "@/lib/payments/safepay/client";
import { handleSafepayWebhook } from "@/lib/payments/safepay/handle-webhook";
import { signSafepayWebhookBody } from "@/lib/payments/safepay/signature";
import type { CreditPackOrder, GrantCredits, PaymentLookup } from "@/lib/payments/types";

const SECRET = "test-webhook-secret";
const ORDER_ID = "550e8400-e29b-41d4-a716-446655440000";
const BRAND_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TRACKER = "track_4f7d7e2d-ee05-44e3-81b7-6f6f2cca9727";

function pendingOrder(overrides: Partial<CreditPackOrder> = {}): CreditPackOrder {
  const pack = getCreditPack("starter");
  assert.ok(pack);

  return {
    id: ORDER_ID,
    brandId: BRAND_ID,
    packId: pack.id,
    credits: pack.credits,
    amountPaisa: pack.amountPaisa,
    currency: "PKR",
    provider: "safepay",
    providerEnvironment: "sandbox",
    status: "pending",
    providerTracker: TRACKER,
    creditIdempotencyKey: `credit-pack:${ORDER_ID}`,
    grantedTransactionId: null,
    failureCode: null,
    ...overrides,
  };
}

function paidLookup(amountPaisa = pendingOrder().amountPaisa): PaymentLookup {
  return { status: "paid", tracker: TRACKER, amountPaisa, currency: "PKR" };
}

function createLedger() {
  const grants = new Map<string, { transactionId: string; credits: number }>();
  let calls = 0;

  const grantCredits: GrantCredits = async (order) => {
    calls += 1;
    const existing = grants.get(order.creditIdempotencyKey);

    if (existing) {
      if (existing.credits !== order.credits) {
        throw new Error("Idempotency key conflict");
      }

      return { transactionId: existing.transactionId, wasCreated: false };
    }

    const transactionId = `tx-${grants.size + 1}`;
    grants.set(order.creditIdempotencyKey, { transactionId, credits: order.credits });
    return { transactionId, wasCreated: true };
  };

  return {
    grantCredits,
    calls: () => calls,
    totalCredits: () => [...grants.values()].reduce((sum, grant) => sum + grant.credits, 0),
  };
}

function webhookBody(eventType: string, success: boolean): string {
  return JSON.stringify({
    type: eventType,
    data: {
      tracker: TRACKER,
      success,
    },
  });
}

describe("credit pack order creation", () => {
  it("stores a pending order and returns the hosted checkout URL without granting credits", async () => {
    const ledger = createLedger();
    const inserted: CreditPackOrder[] = [];
    let attached = "";
    const pack = getCreditPack("growth");
    assert.ok(pack);

    const result = await createCreditPackCheckout({
      orderId: ORDER_ID,
      brandId: BRAND_ID,
      packId: "growth",
      provider: "safepay",
      providerEnvironment: "sandbox",
      pendingCount: 0,
      pendingLimit: CREDIT_PACK_PENDING_LIMIT,
      successUrl: "https://dekhlo.example/success",
      cancelUrl: "https://dekhlo.example/cancel",
      insertOrder: async (order) => {
        inserted.push(order);
      },
      attachTracker: async (_orderId, tracker) => {
        attached = tracker;
      },
      markFailed: async () => {
        throw new Error("should not fail");
      },
      createCheckout: async ({ order, successUrl, cancelUrl }) => {
        assert.equal(order.amountPaisa, pack.amountPaisa);
        assert.equal(order.credits, pack.credits);
        assert.equal(order.status, "pending");
        assert.equal(successUrl, "https://dekhlo.example/success");
        assert.equal(cancelUrl, "https://dekhlo.example/cancel");
        return {
          tracker: TRACKER,
          checkoutUrl: "https://sandbox.api.getsafepay.com/embedded/?tracker=1",
        };
      },
    });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.providerTracker, null);
    assert.equal(attached, TRACKER);
    assert.equal(result.order.providerTracker, TRACKER);
    assert.equal(result.order.creditIdempotencyKey, `credit-pack:${ORDER_ID}`);
    assert.equal(ledger.calls(), 0);
    assert.equal(ledger.totalCredits(), 0);
  });

  it("rejects an unknown pack before inserting an order", async () => {
    let inserted = 0;

    await assert.rejects(
      () =>
        createCreditPackCheckout({
          orderId: ORDER_ID,
          brandId: BRAND_ID,
          packId: "not-a-pack",
          provider: "safepay",
          providerEnvironment: "sandbox",
          pendingCount: 0,
          pendingLimit: CREDIT_PACK_PENDING_LIMIT,
          successUrl: "https://dekhlo.example/success",
          cancelUrl: "https://dekhlo.example/cancel",
          insertOrder: async () => {
            inserted += 1;
          },
          attachTracker: async () => undefined,
          markFailed: async () => undefined,
          createCheckout: async () => {
            throw new Error("should not create checkout");
          },
        }),
      /unknown_pack/,
    );

    assert.equal(inserted, 0);
  });

  it("marks the order failed when Safepay cannot open checkout", async () => {
    const failures: string[] = [];

    await assert.rejects(
      () =>
        createCreditPackCheckout({
          orderId: ORDER_ID,
          brandId: BRAND_ID,
          packId: "starter",
          provider: "safepay",
          providerEnvironment: "sandbox",
          pendingCount: 0,
          pendingLimit: CREDIT_PACK_PENDING_LIMIT,
          successUrl: "https://dekhlo.example/success",
          cancelUrl: "https://dekhlo.example/cancel",
          insertOrder: async () => undefined,
          attachTracker: async () => undefined,
          markFailed: async (_orderId, code) => {
            failures.push(code);
          },
          createCheckout: async () => {
            throw new Error("safepay down");
          },
        }),
      /provider_unavailable/,
    );

    assert.deepEqual(failures, ["checkout_failed"]);
  });
});

describe("Safepay webhook signatures", () => {
  it("accepts an HMAC-SHA512 signature of the raw body", () => {
    const raw = webhookBody("payment.succeeded", true);
    const signature = signSafepayWebhookBody(raw, SECRET);
    assert.equal(
      createHmac("sha512", SECRET).update(raw, "utf8").digest("hex"),
      signature,
    );

    return handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signature,
      webhookSecret: SECRET,
      findOrderByTracker: async () => null,
      lookupPayment: async () => {
        throw new Error("missing order should not be looked up");
      },
      grantCredits: async () => {
        throw new Error("should not grant");
      },
      saveOrder: async () => undefined,
    }).then((result) => {
      assert.equal(result.status, 200);
      assert.equal(result.granted, false);
    });
  });

  it("rejects a missing or mismatched signature before lookup or grant", async () => {
    const raw = webhookBody("payment.succeeded", true);
    let lookups = 0;
    const deps = {
      findOrderByTracker: async () => pendingOrder(),
      lookupPayment: async () => {
        lookups += 1;
        return paidLookup();
      },
      grantCredits: async () => {
        throw new Error("should not grant");
      },
      saveOrder: async () => undefined,
    };

    const missing = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: null,
      webhookSecret: SECRET,
      ...deps,
    });
    const tampered = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signSafepayWebhookBody(`${raw} `, SECRET),
      webhookSecret: SECRET,
      ...deps,
    });

    assert.equal(missing.status, 401);
    assert.equal(tampered.status, 401);
    assert.equal(lookups, 0);
  });
});

describe("idempotent credit grant", () => {
  it("grants once when the same paid webhook is delivered twice", async () => {
    const ledger = createLedger();
    let stored = pendingOrder();
    const raw = webhookBody("payment.succeeded", true);
    const signature = signSafepayWebhookBody(raw, SECRET);

    const first = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signature,
      webhookSecret: SECRET,
      findOrderByTracker: async () => stored,
      lookupPayment: async () => paidLookup(),
      grantCredits: ledger.grantCredits,
      saveOrder: async (order) => {
        stored = order;
      },
    });
    const second = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signature,
      webhookSecret: SECRET,
      findOrderByTracker: async () => stored,
      lookupPayment: async () => paidLookup(),
      grantCredits: ledger.grantCredits,
      saveOrder: async (order) => {
        stored = order;
      },
    });

    assert.equal(first.granted, true);
    assert.equal(second.granted, false);
    assert.equal(second.status, 200);
    assert.equal(stored.status, "paid");
    assert.equal(ledger.calls(), 1);
    assert.equal(ledger.totalCredits(), stored.credits);
  });

  it("keeps a single ledger entry when two confirmations overlap before the order is saved", async () => {
    const ledger = createLedger();
    const order = pendingOrder();
    const [first, second] = await Promise.all([
      settleCreditPackOrder(order, paidLookup(), {
        grantCredits: ledger.grantCredits,
        saveOrder: async () => undefined,
      }),
      settleCreditPackOrder(order, paidLookup(), {
        grantCredits: ledger.grantCredits,
        saveOrder: async () => undefined,
      }),
    ]);

    assert.equal(first.order.status, "paid");
    assert.equal(second.order.status, "paid");
    assert.equal(first.order.grantedTransactionId, second.order.grantedTransactionId);
    assert.equal(ledger.totalCredits(), order.credits);
    assert.equal([first.granted, second.granted].filter(Boolean).length, 1);
  });
});

describe("payment failure paths", () => {
  it("does not grant when the client payload says success but Safepay has not ended the tracker", async () => {
    const ledger = createLedger();
    let stored = pendingOrder();
    const raw = webhookBody("payment.succeeded", true);

    const result = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signSafepayWebhookBody(raw, SECRET),
      webhookSecret: SECRET,
      findOrderByTracker: async () => stored,
      lookupPayment: async () => ({ status: "pending", tracker: TRACKER }),
      grantCredits: ledger.grantCredits,
      saveOrder: async (order) => {
        stored = order;
      },
    });

    assert.equal(result.granted, false);
    assert.equal(stored.status, "pending");
    assert.equal(ledger.totalCredits(), 0);
  });

  it("does not grant when the captured amount does not match the pack", async () => {
    const ledger = createLedger();
    let stored = pendingOrder();

    const result = await settleCreditPackOrder(stored, paidLookup(stored.amountPaisa + 100), {
      grantCredits: ledger.grantCredits,
      saveOrder: async (order) => {
        stored = order;
      },
    });

    assert.equal(result.granted, false);
    assert.equal(stored.status, "failed");
    assert.equal(stored.failureCode, "amount_mismatch");
    assert.equal(ledger.calls(), 0);
  });

  it("marks a terminal Safepay failure without granting", async () => {
    const ledger = createLedger();
    let stored = pendingOrder();

    const result = await settleCreditPackOrder(
      stored,
      { status: "failed", tracker: TRACKER, failureCode: "tracker_expired" },
      {
        grantCredits: ledger.grantCredits,
        saveOrder: async (order) => {
          stored = order;
        },
      },
    );

    assert.equal(result.order.status, "failed");
    assert.equal(ledger.calls(), 0);
  });

  it("grants from a failed webhook only when Safepay reports the tracker ended", async () => {
    const ledger = createLedger();
    let stored = pendingOrder();
    const raw = webhookBody("payment.failed", false);

    const result = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signSafepayWebhookBody(raw, SECRET),
      webhookSecret: SECRET,
      findOrderByTracker: async () => stored,
      lookupPayment: async () => paidLookup(),
      grantCredits: ledger.grantCredits,
      saveOrder: async (order) => {
        stored = order;
      },
    });

    assert.equal(result.granted, true);
    assert.equal(stored.status, "paid");
  });

  it("returns 500 and does not grant when tracker verification fails", async () => {
    const ledger = createLedger();
    const raw = webhookBody("payment.succeeded", true);

    const result = await handleSafepayWebhook({
      rawBody: raw,
      signatureHeader: signSafepayWebhookBody(raw, SECRET),
      webhookSecret: SECRET,
      findOrderByTracker: async () => pendingOrder(),
      lookupPayment: async () => {
        throw new Error("safepay unavailable");
      },
      grantCredits: ledger.grantCredits,
      saveOrder: async () => {
        throw new Error("should not save");
      },
    });

    assert.equal(result.status, 500);
    assert.equal(ledger.calls(), 0);
  });
});

describe("Safepay checkout client", () => {
  const config = resolveSafepayConfig({
    SAFEPAY_ENVIRONMENT: "sandbox",
    SAFEPAY_API_KEY: "sec_public",
    SAFEPAY_SECRET_KEY: "sec_secret",
    SAFEPAY_WEBHOOK_SECRET: SECRET,
  });

  it("creates a PKR payment session and a hosted checkout URL", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.endsWith("/order/payments/v3/")) {
        const body = JSON.parse(String(init?.body)) as {
          currency: string;
          amount: number;
          intent: string;
          mode: string;
          merchant_api_key: string;
        };
        assert.equal(body.currency, "PKR");
        assert.equal(body.amount, 250_000);
        assert.equal(body.intent, "CYBERSOURCE");
        assert.equal(body.mode, "payment");
        assert.equal(body.merchant_api_key, "sec_public");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-sfpy-merchant-secret"), "sec_secret");

        return new Response(
          JSON.stringify({
            data: { tracker: { token: TRACKER, state: "TRACKER_STARTED" } },
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ data: "passport-token" }), { status: 200 });
    };

    const provider = createSafepayProvider(config, fetchImpl);
    const checkout = await provider.createCheckout({
      order: pendingOrder({ providerTracker: null }),
      successUrl: "https://dekhlo.example/dashboard/credits/checkout/success/" + ORDER_ID,
      cancelUrl: "https://dekhlo.example/dashboard/credits/checkout/cancel/" + ORDER_ID,
    });

    assert.equal(checkout.tracker, TRACKER);
    const checkoutUrl = new URL(checkout.checkoutUrl);
    assert.equal(checkoutUrl.origin, "https://sandbox.api.getsafepay.com");
    assert.equal(checkoutUrl.pathname, "/embedded/");
    assert.equal(checkoutUrl.searchParams.get("environment"), "sandbox");
    assert.equal(checkoutUrl.searchParams.get("source"), "hosted");
    assert.equal(checkoutUrl.searchParams.get("tracker"), TRACKER);
    assert.equal(checkoutUrl.searchParams.get("tbt"), "passport-token");
    assert.equal(calls.length, 2);
  });

  it("reads TRACKER_ENDED as a paid PKR amount and leaves in-progress trackers pending", () => {
    const paid = interpretTrackerPayload(
      {
        data: {
          tracker: {
            token: TRACKER,
            client: "sec_public",
            state: "TRACKER_ENDED",
            purchase_totals: { quote_amount: { currency: "PKR", amount: 250_000 } },
          },
        },
      },
      TRACKER,
      "sec_public",
    );
    const otherMerchant = interpretTrackerPayload(
      {
        data: {
          tracker: {
            token: TRACKER,
            client: "sec_other",
            state: "TRACKER_ENDED",
            purchase_totals: { quote_amount: { currency: "PKR", amount: 250_000 } },
          },
        },
      },
      TRACKER,
      "sec_public",
    );
    const pending = interpretTrackerPayload(
      { data: { tracker: { token: TRACKER, state: "TRACKER_STARTED" } } },
      TRACKER,
    );

    assert.deepEqual(paid, {
      status: "paid",
      tracker: TRACKER,
      amountPaisa: 250_000,
      currency: "PKR",
    });
    assert.deepEqual(pending, { status: "pending", tracker: TRACKER });
    assert.equal(otherMerchant.status, "failed");
    if (otherMerchant.status === "failed") {
      assert.equal(otherMerchant.failureCode, "merchant_mismatch");
    }
  });

  it("requires an explicit sandbox or production environment", () => {
    assert.throws(
      () =>
        resolveSafepayConfig({
          SAFEPAY_API_KEY: "sec_public",
          SAFEPAY_SECRET_KEY: "sec_secret",
          SAFEPAY_WEBHOOK_SECRET: SECRET,
        }),
      /SAFEPAY_ENVIRONMENT/,
    );

    const production = resolveSafepayConfig({
      SAFEPAY_ENVIRONMENT: "production",
      SAFEPAY_API_KEY: "sec_public",
      SAFEPAY_SECRET_KEY: "sec_secret",
      SAFEPAY_WEBHOOK_SECRET: SECRET,
    });
    assert.equal(production.apiHost, "https://api.getsafepay.com");
    assert.equal(production.checkoutBaseUrl, "https://getsafepay.com/embedded/");
  });
});
