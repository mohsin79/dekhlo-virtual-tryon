import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type TryOnSessionRow = Database["public"]["Tables"]["try_on_sessions"]["Row"];

export async function getSessionById(sessionId: string): Promise<TryOnSessionRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("try_on_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function getSessionByClientRequestId(
  clientRequestId: string,
): Promise<TryOnSessionRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("try_on_sessions")
    .select("*")
    .eq("client_request_id", clientRequestId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function insertTryOnSession(input: {
  id: string;
  brandId: string;
  productId: string;
  clientRequestId: string;
  anonymousTokenHash: string;
  personStoragePath: string;
  consentToStore: boolean;
  expiresAt: string;
}): Promise<TryOnSessionRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("try_on_sessions")
    .insert({
      id: input.id,
      brand_id: input.brandId,
      product_id: input.productId,
      client_request_id: input.clientRequestId,
      anonymous_token_hash: input.anonymousTokenHash,
      person_storage_path: input.personStoragePath,
      consent_to_store: input.consentToStore,
      expires_at: input.expiresAt,
      status: "pending_upload",
      credit_cost: null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function markSessionUploadValidated(sessionId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("try_on_sessions")
    .update({ upload_validated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "pending_upload");

  return !error;
}

export async function markSessionProcessing(sessionId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("try_on_sessions")
    .update({ status: "processing" })
    .eq("id", sessionId)
    .eq("status", "queued");

  return !error;
}

export async function setSessionResultPath(sessionId: string, resultStoragePath: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("try_on_sessions")
    .update({ result_storage_path: resultStoragePath })
    .eq("id", sessionId);

  return !error;
}

export async function markSessionFailed(
  sessionId: string,
  errorCode: string,
  sanitizedErrorMessage: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("try_on_sessions")
    .update({
      status: "failed",
      error_code: errorCode,
      sanitized_error_message: sanitizedErrorMessage,
    })
    .eq("id", sessionId);

  return !error;
}

export async function callQueueTryOnSession(sessionId: string) {
  const supabase = createAdminClient();
  return supabase.rpc("queue_try_on_session", { p_session_id: sessionId });
}

export async function callConsumeReservedBrandCredits(sessionId: string) {
  const supabase = createAdminClient();
  return supabase.rpc("consume_reserved_brand_credits", { p_session_id: sessionId });
}

export async function callReleaseReservedBrandCredits(sessionId: string) {
  const supabase = createAdminClient();
  return supabase.rpc("release_reserved_brand_credits", { p_session_id: sessionId });
}

export function isSessionExpired(session: TryOnSessionRow): boolean {
  return new Date(session.expires_at).getTime() <= Date.now();
}

export function isSessionDeleted(session: TryOnSessionRow): boolean {
  return session.deleted_at != null;
}

export function toPublicSessionStatus(session: TryOnSessionRow) {
  return {
    sessionId: session.id,
    status: session.status,
    errorCode: session.error_code,
    sanitizedErrorMessage: session.sanitized_error_message,
    expiresAt: session.expires_at,
    completedAt: session.completed_at,
  };
}
