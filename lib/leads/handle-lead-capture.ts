import "server-only";

import { z } from "zod";
import {
  assertJsonRequest,
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
  rateLimitedResponse,
} from "@/lib/api/security";
import {
  LEAD_MAX_JSON_BODY_BYTES,
  LEAD_MIN_SECONDS_AFTER_COMPLETION,
  LEAD_UNAVAILABLE_MESSAGE,
} from "@/lib/leads/constants";
import { mapLeadRpcError } from "@/lib/leads/lead-api-errors";
import { buildLeadGetResponse, buildLeadPostResponse } from "@/lib/leads/public-response";
import { buildLeadSnapshotMetadata } from "@/lib/leads/snapshot-metadata";
import { parseLeadCaptureBody } from "@/lib/leads/validation";
import { captureUnexpectedError } from "@/lib/observability/sentry";
import { shouldCaptureRpcMappedStatus } from "@/lib/observability/capture-policy";
import {
  limitLeadCaptureByIp,
  limitLeadCaptureBySession,
  limitLeadCaptureGlobal,
} from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeTryOnSessionForLead } from "@/lib/try-on/sessions/lead-session-auth";
import type { NextResponse } from "next/server";

type RpcRow = {
  lead_id: string;
  was_created: boolean;
};

export async function handleLeadCapturePost(
  request: Request,
  sessionId: string,
): Promise<NextResponse> {
  const sessionIdParsed = z.string().uuid().safeParse(sessionId);

  if (!sessionIdParsed.success) {
    return genericErrorResponse(LEAD_UNAVAILABLE_MESSAGE, 404);
  }

  if (!assertJsonRequest(request)) {
    return genericErrorResponse("Expected application/json.", 415);
  }

  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength) {
    const length = Number.parseInt(contentLength, 10);

    if (Number.isFinite(length) && length > LEAD_MAX_JSON_BODY_BYTES) {
      return genericErrorResponse("Request body is too large.", 400);
    }
  }

  const auth = await authorizeTryOnSessionForLead(sessionIdParsed.data);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
  }

  const session = auth.value.session;

  const [sessionLimit, ipLimit, globalLimit] = await Promise.all([
    limitLeadCaptureBySession(session.id),
    limitLeadCaptureByIp(request),
    limitLeadCaptureGlobal(),
  ]);

  if (!sessionLimit.success || !ipLimit.success || !globalLimit.success) {
    return rateLimitedResponse();
  }

  if (session.completed_at) {
    const completedAtMs = new Date(session.completed_at).getTime();
    const earliestMs = completedAtMs + LEAD_MIN_SECONDS_AFTER_COMPLETION * 1000;

    if (Date.now() < earliestMs) {
      return genericErrorResponse(LEAD_UNAVAILABLE_MESSAGE, 404);
    }
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return genericErrorResponse("Invalid JSON body.", 400);
  }

  const parsed = parseLeadCaptureBody(body);

  if (!parsed.success) {
    const status = parsed.error.includes("consent") ? 422 : 400;
    return genericErrorResponse(parsed.error, status);
  }

  const metadataResult = await buildLeadSnapshotMetadata(session.brand_id, session.product_id);

  if (!metadataResult.ok) {
    return genericErrorResponse(LEAD_UNAVAILABLE_MESSAGE, 404);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("create_try_on_lead", {
    p_session_id: session.id,
    p_full_name: parsed.data.normalizedFullName ?? "",
    p_email: parsed.data.normalizedEmail,
    p_phone: parsed.data.normalizedPhone ?? "",
    p_consent_to_contact: true,
    p_consent_to_marketing: parsed.data.consentToMarketing,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_metadata: metadataResult.metadata,
  });

  if (error) {
    const mapped = mapLeadRpcError(error.message ?? "");

    if (shouldCaptureRpcMappedStatus(mapped.status)) {
      captureUnexpectedError(error, {
        routeCategory: "lead_capture",
        operation: "create_try_on_lead",
        errorCategory: "supabase_rpc",
      });
    }

    return genericErrorResponse(mapped.error, mapped.status);
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;

  if (!row?.lead_id) {
    captureUnexpectedError(new Error("Lead RPC returned no lead_id."), {
      routeCategory: "lead_capture",
      operation: "create_try_on_lead",
      errorCategory: "empty_rpc_result",
    });

    return genericErrorResponse("Unable to submit lead.", 500);
  }

  return jsonNoStore(buildLeadPostResponse(row.lead_id, row.was_created), {
    status: row.was_created ? 201 : 200,
  });
}

export async function handleLeadCaptureGet(sessionId: string): Promise<NextResponse> {
  const sessionIdParsed = z.string().uuid().safeParse(sessionId);

  if (!sessionIdParsed.success) {
    return genericErrorResponse(LEAD_UNAVAILABLE_MESSAGE, 404);
  }

  const auth = await authorizeTryOnSessionForLead(sessionIdParsed.data);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("try_on_session_id")
    .eq("try_on_session_id", auth.value.session.id)
    .maybeSingle();

  if (error) {
    captureUnexpectedError(error, {
      routeCategory: "lead_capture",
      operation: "load_lead_status",
      errorCategory: "supabase_query",
    });

    return genericErrorResponse("Unable to load lead status.", 500);
  }

  const submitted = data != null;

  return jsonNoStore(buildLeadGetResponse(submitted));
}
