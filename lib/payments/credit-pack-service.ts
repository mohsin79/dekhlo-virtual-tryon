import "server-only";

import { randomUUID } from "node:crypto";
import { getCreditPack, CREDIT_PACK_PENDING_LIMIT } from "@/lib/payments/credit-packs";
import {
  createCreditPackCheckout,
  CreditPackCheckoutError,
  settleCreditPackOrder,
} from "@/lib/payments/orders";
import {
  resolveSafepayConfig,
  SafepayConfigError,
  safepayEnvFromProcess,
} from "@/lib/payments/safepay/config";
import { createSafepayProvider } from "@/lib/payments/safepay/client";
import { handleSafepayWebhook } from "@/lib/payments/safepay/handle-webhook";
import type { CreditPackOrder, CreditPackOrderStatus, PaymentEnvironment } from "@/lib/payments/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { getSiteUrl } from "@/lib/env";

type OrderRow = {
  id: string;
  brand_id: string;
  pack_id: string;
  credits: number;
  amount_paisa: number;
  currency: string;
  provider: string;
  provider_environment: string;
  status: string;
  provider_tracker: string | null;
  credit_idempotency_key: string;
  granted_transaction_id: string | null;
  failure_code: string | null;
};

const ORDER_COLUMNS =
  "id, brand_id, pack_id, credits, amount_paisa, currency, provider, provider_environment, status, provider_tracker, credit_idempotency_key, granted_transaction_id, failure_code";

function isStatus(value: string): value is CreditPackOrderStatus {
  return value === "pending" || value === "paid" || value === "failed" || value === "cancelled";
}

function isEnvironment(value: string): value is PaymentEnvironment {
  return value === "sandbox" || value === "production";
}

function mapOrder(row: OrderRow): CreditPackOrder | null {
  if (row.currency !== "PKR" || !isStatus(row.status) || !isEnvironment(row.provider_environment)) {
    return null;
  }

  return {
    id: row.id,
    brandId: row.brand_id,
    packId: row.pack_id,
    credits: row.credits,
    amountPaisa: row.amount_paisa,
    currency: "PKR",
    provider: row.provider,
    providerEnvironment: row.provider_environment,
    status: row.status,
    providerTracker: row.provider_tracker,
    creditIdempotencyKey: row.credit_idempotency_key,
    grantedTransactionId: row.granted_transaction_id,
    failureCode: row.failure_code,
  };
}

function safepayRuntime() {
  const config = resolveSafepayConfig(safepayEnvFromProcess());
  return { config, provider: createSafepayProvider(config) };
}

function returnUrls(orderId: string): { successUrl: string; cancelUrl: string } {
  const base = getSiteUrl();

  return {
    successUrl: `${base}/dashboard/credits/checkout/success/${orderId}`,
    cancelUrl: `${base}/dashboard/credits/checkout/cancel/${orderId}`,
  };
}

async function loadOrderById(orderId: string): Promise<CreditPackOrder | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("credit_pack_orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapOrder(data) : null;
}

async function saveOrder(order: CreditPackOrder): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("credit_pack_orders")
    .update({
      status: order.status,
      provider_tracker: order.providerTracker,
      granted_transaction_id: order.grantedTransactionId,
      failure_code: order.failureCode,
      paid_at: order.status === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", order.id)
    .neq("status", "paid");

  if (error) {
    throw error;
  }
}

async function grantOrderCredits(order: CreditPackOrder): Promise<{
  transactionId: string;
  wasCreated: boolean;
}> {
  const pack = getCreditPack(order.packId);
  const admin = createAdminClient();
  const metadata: Json = {
    source: "safepay_credit_pack",
    reason: pack ? `${pack.name} credit pack` : "Credit pack",
    order_id: order.id,
    pack_id: order.packId,
    provider: order.provider,
    tracker: order.providerTracker,
  };
  const { data, error } = await admin.rpc("grant_brand_credits", {
    p_brand_id: order.brandId,
    p_amount: order.credits,
    p_idempotency_key: order.creditIdempotencyKey,
    p_metadata: metadata,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.transaction_id) {
    throw new Error("Credit grant returned no transaction.");
  }

  return {
    transactionId: row.transaction_id,
    wasCreated: row.was_created,
  };
}

export async function startSafepayCreditPackCheckout(input: {
  brandId: string;
  userId: string;
  packId: string;
}): Promise<string> {
  const { config, provider } = safepayRuntime();
  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("credit_pack_orders")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", input.brandId)
    .eq("status", "pending");

  if (countError) {
    throw countError;
  }

  const orderId = randomUUID();
  const urls = returnUrls(orderId);
  const { checkoutUrl } = await createCreditPackCheckout({
    orderId,
    brandId: input.brandId,
    packId: input.packId,
    provider: provider.id,
    providerEnvironment: config.environment,
    pendingCount: count ?? 0,
    pendingLimit: CREDIT_PACK_PENDING_LIMIT,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    insertOrder: async (order) => {
      const { error } = await admin.from("credit_pack_orders").insert({
        id: order.id,
        brand_id: order.brandId,
        created_by: input.userId,
        pack_id: order.packId,
        credits: order.credits,
        amount_paisa: order.amountPaisa,
        currency: order.currency,
        provider: order.provider,
        provider_environment: order.providerEnvironment,
        status: order.status,
        credit_idempotency_key: order.creditIdempotencyKey,
      });

      if (error) {
        throw error;
      }
    },
    attachTracker: async (id, tracker) => {
      const { error } = await admin
        .from("credit_pack_orders")
        .update({ provider_tracker: tracker })
        .eq("id", id);

      if (error) {
        throw error;
      }
    },
    markFailed: async (id, failureCode) => {
      const { error } = await admin
        .from("credit_pack_orders")
        .update({ status: "failed", failure_code: failureCode })
        .eq("id", id)
        .eq("status", "pending");

      if (error) {
        console.error("[payments] mark_failed", { orderId: id, failureCode });
      }
    },
    createCheckout: (checkoutInput) => provider.createCheckout(checkoutInput),
  });

  return checkoutUrl;
}

export function checkoutErrorCode(error: unknown): string {
  if (error instanceof CreditPackCheckoutError || error instanceof SafepayConfigError) {
    return error instanceof CreditPackCheckoutError ? error.code : "not_configured";
  }

  return "error";
}

export type ReconcileView = {
  order: CreditPackOrder | null;
  confirmationUnavailable: boolean;
};

export async function reconcileCreditPackOrderForBrand(
  orderId: string,
  brandId: string,
  options: { abandonIfPending: boolean },
): Promise<ReconcileView> {
  const order = await loadOrderById(orderId);

  if (!order || order.brandId !== brandId) {
    return { order: null, confirmationUnavailable: false };
  }

  if (order.status === "paid") {
    return { order, confirmationUnavailable: false };
  }

  if (!order.providerTracker) {
    if (options.abandonIfPending && order.status === "pending") {
      const cancelled: CreditPackOrder = { ...order, status: "cancelled", failureCode: null };
      await saveOrder(cancelled);
      return { order: cancelled, confirmationUnavailable: false };
    }

    return { order, confirmationUnavailable: false };
  }

  let provider;
  let environment: PaymentEnvironment;

  try {
    const runtime = safepayRuntime();
    provider = runtime.provider;
    environment = runtime.config.environment;
  } catch (error) {
    console.error("[payments] reconcile_unconfigured", {
      orderId: order.id,
      code: checkoutErrorCode(error),
    });
    return { order, confirmationUnavailable: true };
  }

  if (order.providerEnvironment !== environment) {
    return { order, confirmationUnavailable: true };
  }

  try {
    const lookup = await provider.lookupPayment(order.providerTracker);
    const settled = await settleCreditPackOrder(
      order,
      lookup,
      { grantCredits: grantOrderCredits, saveOrder },
      { abandonIfPending: options.abandonIfPending },
    );

    return { order: settled.order, confirmationUnavailable: false };
  } catch (error) {
    console.error("[payments] reconcile_failed", {
      orderId: order.id,
      code: checkoutErrorCode(error),
    });
    return { order, confirmationUnavailable: true };
  }
}

export async function receiveSafepayWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<{ status: number }> {
  const { config, provider } = safepayRuntime();
  const admin = createAdminClient();
  const result = await handleSafepayWebhook({
    rawBody,
    signatureHeader,
    webhookSecret: config.webhookSecret,
    findOrderByTracker: async (tracker) => {
      const { data, error } = await admin
        .from("credit_pack_orders")
        .select(ORDER_COLUMNS)
        .eq("provider", "safepay")
        .eq("provider_tracker", tracker)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const order = data ? mapOrder(data) : null;

      if (order && order.providerEnvironment !== config.environment) {
        return null;
      }

      return order;
    },
    lookupPayment: (order) => provider.lookupPayment(order.providerTracker ?? ""),
    grantCredits: grantOrderCredits,
    saveOrder,
  });

  return { status: result.status };
}
