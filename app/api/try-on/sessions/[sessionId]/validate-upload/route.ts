import "server-only";

import {
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
} from "@/lib/api/security";
import { authorizeSessionAccess } from "@/lib/try-on/sessions/auth";
import {
  callQueueTryOnSession,
  markSessionFailed,
  markSessionUploadValidated,
  toPublicSessionStatus,
} from "@/lib/try-on/sessions/service";
import { downloadPersonPhoto, removePersonPhoto } from "@/lib/try-on/sessions/storage";
import { validatePersonPhotoBuffer } from "@/lib/try-on/sessions/person-validation";
import { mimeTypeToExtension } from "@/lib/try-on/sessions/constants";
import { buildPersonStoragePath } from "@/lib/try-on/sessions/paths";
import { dispatchTryOnGeneration } from "@/lib/try-on/sessions/dispatch-generation";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  if (!assertSameOrigin(_request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  const { sessionId } = await context.params;
  const auth = await authorizeSessionAccess(sessionId);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
  }

  const session = auth.value.session;

  if (session.status !== "pending_upload") {
    return jsonNoStore(toPublicSessionStatus(session));
  }

  if (!session.person_storage_path) {
    return genericErrorResponse("Upload path is unavailable.", 409);
  }

  const buffer = await downloadPersonPhoto(session.person_storage_path);

  if (!buffer) {
    return genericErrorResponse("Uploaded photo was not found.", 400);
  }

  const validation = validatePersonPhotoBuffer(buffer);

  if (!validation.ok) {
    await removePersonPhoto(session.person_storage_path);
    await markSessionFailed(sessionId, validation.error.code, validation.error.message);
    return genericErrorResponse(validation.error.message, 400);
  }

  const expectedExtension = mimeTypeToExtension(validation.value.mimeType);
  const expectedPath = buildPersonStoragePath(session.brand_id, sessionId, expectedExtension);

  if (session.person_storage_path !== expectedPath) {
    const supabase = createAdminClient();
    const { error: moveError } = await supabase.storage
      .from("customer-uploads")
      .move(session.person_storage_path, expectedPath);

    if (moveError) {
      const uploaded = await supabase.storage
        .from("customer-uploads")
        .upload(expectedPath, validation.value.buffer, {
          contentType: validation.value.mimeType,
          upsert: true,
        });

      if (uploaded.error) {
        await removePersonPhoto(session.person_storage_path);
        await markSessionFailed(sessionId, "UPLOAD_INVALID", "Uploaded photo could not be validated.");
        return genericErrorResponse("Uploaded photo could not be validated.", 400);
      }

      await removePersonPhoto(session.person_storage_path);
    }

    await supabase
      .from("try_on_sessions")
      .update({ person_storage_path: expectedPath })
      .eq("id", sessionId);
  }

  const validated = await markSessionUploadValidated(sessionId);

  if (!validated) {
    return genericErrorResponse("Unable to validate upload.", 503);
  }

  const queueResult = await callQueueTryOnSession(sessionId);

  if (queueResult.error) {
    const message = queueResult.error.message ?? "";

    if (message.includes("Insufficient credits")) {
      await markSessionFailed(
        sessionId,
        "INSUFFICIENT_CREDITS",
        "This brand does not have enough credits to start a try-on right now.",
      );

      return jsonNoStore(
        {
          ...toPublicSessionStatus({
            ...session,
            status: "failed",
            error_code: "INSUFFICIENT_CREDITS",
            sanitized_error_message:
              "This brand does not have enough credits to start a try-on right now.",
          }),
        },
        { status: 402 },
      );
    }

    await markSessionFailed(sessionId, "QUEUE_FAILED", "Unable to queue this try-on.");
    return genericErrorResponse("Unable to queue this try-on.", 503);
  }

  const row = queueResult.data?.[0];

  await dispatchTryOnGeneration({
    sessionId,
    brandId: session.brand_id,
  });

  return jsonNoStore(
    {
      sessionId,
      status: row?.status ?? "queued",
      expiresAt: session.expires_at,
    },
    { status: 202 },
  );
}
