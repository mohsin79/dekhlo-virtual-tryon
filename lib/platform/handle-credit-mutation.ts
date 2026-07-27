import "server-only";

import {
  assertJsonRequest,
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
} from "@/lib/api/security";
import { getAuthenticatedUser } from "@/lib/auth/get-user-context";
import { isPlatformAdminProfile } from "@/lib/platform/is-platform-admin-profile";
import { PLATFORM_MAX_JSON_BODY_BYTES } from "@/lib/platform/constants";
import { mapPlatformCreditRpcError } from "@/lib/platform/credit-api-errors";
import { loadPlatformAdminProfile } from "@/lib/platform/require-platform-admin";
import { parsePlatformCreditMutationBody } from "@/lib/platform/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextResponse } from "next/server";

export type PlatformCreditSuccessResponse = {
  transactionId: string;
  auditLogId: string;
  brandId: string;
  grantedCredits: number;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number;
  wasCreated: boolean;
};

type RpcRow = {
  transaction_id: string;
  audit_log_id: string;
  brand_id: string;
  granted_credits: number;
  reserved_credits: number;
  consumed_credits: number;
  available_credits: number;
  was_created: boolean;
};

export async function handlePlatformCreditMutation(
  request: Request,
  operation: "grant" | "revoke",
): Promise<NextResponse> {
  if (!assertJsonRequest(request)) {
    return genericErrorResponse("Expected application/json.", 415);
  }

  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength) {
    const length = Number.parseInt(contentLength, 10);

    if (Number.isFinite(length) && length > PLATFORM_MAX_JSON_BODY_BYTES) {
      return genericErrorResponse("Request body is too large.", 400);
    }
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return genericErrorResponse("Authentication required.", 401);
  }

  const profile = await loadPlatformAdminProfile(user.id);

  if (!profile || !isPlatformAdminProfile(profile)) {
    return genericErrorResponse("Platform administrator access required.", 403);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return genericErrorResponse("Invalid JSON body.", 400);
  }

  const parsed = parsePlatformCreditMutationBody(body);

  if (!parsed.success) {
    return genericErrorResponse(parsed.error, 400);
  }

  const admin = createAdminClient();
  const rpcName =
    operation === "grant" ? "admin_grant_brand_credits" : "admin_revoke_brand_credits";

  const { data, error } = await admin.rpc(rpcName, {
    p_brand_id: parsed.data.brandId,
    p_amount: parsed.data.amount,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_reason: parsed.data.reason,
    p_actor: user.id,
  });

  if (error) {
    const mapped = mapPlatformCreditRpcError(error.message ?? "", operation);
    return genericErrorResponse(mapped.error, mapped.status);
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined;

  if (!row) {
    return genericErrorResponse("Unable to complete credit operation.", 500);
  }

  const response: PlatformCreditSuccessResponse = {
    transactionId: row.transaction_id,
    auditLogId: row.audit_log_id,
    brandId: row.brand_id,
    grantedCredits: row.granted_credits,
    reservedCredits: row.reserved_credits,
    consumedCredits: row.consumed_credits,
    availableCredits: row.available_credits,
    wasCreated: row.was_created,
  };

  return jsonNoStore(response);
}
