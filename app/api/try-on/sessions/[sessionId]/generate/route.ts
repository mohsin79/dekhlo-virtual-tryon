import "server-only";

import {
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
} from "@/lib/api/security";
import { bufferToDataUrl, generateTryOnImage } from "@/lib/try-on/generate";
import { authorizeSessionAccess } from "@/lib/try-on/sessions/auth";
import {
  callConsumeReservedBrandCredits,
  callReleaseReservedBrandCredits,
  markSessionFailed,
  markSessionProcessing,
  setSessionResultPath,
  toPublicSessionStatus,
} from "@/lib/try-on/sessions/service";
import {
  createResultReadUrl,
  downloadPersonPhoto,
  removeTryOnResult,
  uploadTryOnResult,
} from "@/lib/try-on/sessions/storage";
import { buildResultStoragePath } from "@/lib/try-on/sessions/paths";
import { getProductImagePublicUrl } from "@/lib/products/public-url";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  const { sessionId } = await context.params;
  const auth = await authorizeSessionAccess(sessionId);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
  }

  const session = auth.value.session;

  if (session.status === "completed") {
    const resultUrl = session.result_storage_path
      ? await createResultReadUrl(session.result_storage_path)
      : null;

    return jsonNoStore({
      ...toPublicSessionStatus(session),
      resultUrl,
    });
  }

  if (session.status !== "queued") {
    return genericErrorResponse("Session is not ready for generation.", 409);
  }

  if (!session.person_storage_path) {
    return genericErrorResponse("Validated photo is unavailable.", 409);
  }

  const started = await markSessionProcessing(sessionId);

  if (!started) {
    return genericErrorResponse("Session is already being processed.", 409);
  }

  const personBuffer = await downloadPersonPhoto(session.person_storage_path);

  if (!personBuffer) {
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "PHOTO_MISSING", "Validated photo could not be loaded.");
    return genericErrorResponse("Validated photo could not be loaded.", 503);
  }

  const supabase = createAdminClient();
  const { data: productRow } = await supabase
    .from("products")
    .select("product_image_path")
    .eq("id", session.product_id)
    .eq("brand_id", session.brand_id)
    .maybeSingle();

  if (!productRow?.product_image_path) {
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "PRODUCT_IMAGE_MISSING", "Product image could not be loaded.");
    return genericErrorResponse("Product image could not be loaded.", 503);
  }

  const publicUrl = await getProductImagePublicUrl(productRow.product_image_path);

  if (!publicUrl) {
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "PRODUCT_IMAGE_MISSING", "Product image could not be loaded.");
    return genericErrorResponse("Product image could not be loaded.", 503);
  }

  const productResponse = await fetch(publicUrl);

  if (!productResponse.ok) {
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "PRODUCT_IMAGE_MISSING", "Product image could not be loaded.");
    return genericErrorResponse("Product image could not be loaded.", 503);
  }

  const itemBuffer = Buffer.from(await productResponse.arrayBuffer());
  const itemDataUrl = await bufferToDataUrl(
    itemBuffer,
    productResponse.headers.get("content-type") ?? "image/jpeg",
  );
  const personDataUrl = await bufferToDataUrl(personBuffer, "image/jpeg");
  const generation = await generateTryOnImage({ personDataUrl, itemDataUrl });

  if (!generation.ok) {
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "GENERATION_FAILED", "Try-on generation failed. Please try again.");
    return genericErrorResponse("Try-on generation failed. Please try again.", 502);
  }

  const resultPath = buildResultStoragePath(session.brand_id, sessionId);
  const resultBuffer = Buffer.from(generation.imageBase64, "base64");
  const uploaded = await uploadTryOnResult(resultPath, resultBuffer);

  if (!uploaded) {
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "RESULT_UPLOAD_FAILED", "Generated result could not be stored.");
    return genericErrorResponse("Generated result could not be stored.", 503);
  }

  const pathSaved = await setSessionResultPath(sessionId, resultPath);

  if (!pathSaved) {
    await removeTryOnResult(resultPath);
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "RESULT_SAVE_FAILED", "Generated result could not be saved.");
    return genericErrorResponse("Generated result could not be saved.", 503);
  }

  const consumeResult = await callConsumeReservedBrandCredits(sessionId);

  if (consumeResult.error) {
    await removeTryOnResult(resultPath);
    await callReleaseReservedBrandCredits(sessionId);
    await markSessionFailed(sessionId, "CONSUME_FAILED", "Try-on could not be finalized.");
    return genericErrorResponse("Try-on could not be finalized.", 503);
  }

  const consumeRow = consumeResult.data?.[0];
  const resultUrl = await createResultReadUrl(resultPath);

  return jsonNoStore({
    sessionId,
    status: consumeRow?.status ?? "completed",
    expiresAt: session.expires_at,
    resultUrl,
  });
}
