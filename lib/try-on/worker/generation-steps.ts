import { bufferToDataUrl, generateTryOnImage } from "@/lib/try-on/generate";
import { buildResultStoragePath } from "@/lib/try-on/sessions/paths";
import {
  callConsumeReservedBrandCredits,
  callReleaseReservedBrandCredits,
  getSessionById,
  markSessionFailed,
  markSessionProcessing,
  setSessionProviderRequestId,
  setSessionResultPath,
  type TryOnSessionRow,
} from "@/lib/try-on/sessions/service";
import {
  downloadPersonPhoto,
  removeTryOnResult,
  uploadTryOnResult,
} from "@/lib/try-on/sessions/storage";
import { getProductImagePublicUrl } from "@/lib/products/public-url";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evaluateSessionForGeneration,
  type LoadedSessionState,
} from "@/lib/try-on/worker/session-evaluation";

export type { LoadedSessionState } from "@/lib/try-on/worker/session-evaluation";
export { evaluateSessionForGeneration } from "@/lib/try-on/worker/session-evaluation";

export class TryOnWorkerPermanentError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly sanitizedMessage: string,
  ) {
    super(message);
    this.name = "TryOnWorkerPermanentError";
  }
}

export async function loadSessionForWorker(sessionId: string): Promise<LoadedSessionState> {
  const session = await getSessionById(sessionId);
  return evaluateSessionForGeneration(session);
}

export async function claimProcessingForWorker(
  sessionId: string,
  providerJobId: string,
): Promise<boolean> {
  const session = await getSessionById(sessionId);

  if (!session) {
    return false;
  }

  if (session.status === "processing") {
    return session.provider_job_id === providerJobId || !session.provider_job_id;
  }

  if (session.status !== "queued") {
    return false;
  }

  return markSessionProcessing(sessionId, providerJobId);
}

export async function downloadPersonPhotoForWorker(session: TryOnSessionRow): Promise<Buffer> {
  if (!session.person_storage_path) {
    throw new TryOnWorkerPermanentError(
      "Validated photo is unavailable.",
      "PHOTO_MISSING",
      "Validated photo could not be loaded.",
    );
  }

  const personBuffer = await downloadPersonPhoto(session.person_storage_path);

  if (!personBuffer) {
    throw new TryOnWorkerPermanentError(
      "Validated photo could not be loaded.",
      "PHOTO_MISSING",
      "Validated photo could not be loaded.",
    );
  }

  return personBuffer;
}

export async function downloadProductImageForWorker(session: TryOnSessionRow): Promise<Buffer> {
  const supabase = createAdminClient();
  const { data: productRow } = await supabase
    .from("products")
    .select("product_image_path")
    .eq("id", session.product_id)
    .eq("brand_id", session.brand_id)
    .maybeSingle();

  if (!productRow?.product_image_path) {
    throw new TryOnWorkerPermanentError(
      "Product image could not be loaded.",
      "PRODUCT_IMAGE_MISSING",
      "Product image could not be loaded.",
    );
  }

  const publicUrl = await getProductImagePublicUrl(productRow.product_image_path);

  if (!publicUrl) {
    throw new TryOnWorkerPermanentError(
      "Product image could not be loaded.",
      "PRODUCT_IMAGE_MISSING",
      "Product image could not be loaded.",
    );
  }

  const productResponse = await fetch(publicUrl);

  if (!productResponse.ok) {
    throw new TryOnWorkerPermanentError(
      "Product image could not be loaded.",
      "PRODUCT_IMAGE_MISSING",
      "Product image could not be loaded.",
    );
  }

  return Buffer.from(await productResponse.arrayBuffer());
}

export async function generateTryOnResultForWorker(input: {
  personBuffer: Buffer;
  itemBuffer: Buffer;
  itemMimeType: string;
}): Promise<{ imageBase64: string; providerRequestId?: string }> {
  const personDataUrl = await bufferToDataUrl(input.personBuffer, "image/jpeg");
  const itemDataUrl = await bufferToDataUrl(input.itemBuffer, input.itemMimeType);
  const generation = await generateTryOnImage({ personDataUrl, itemDataUrl }, {
    reportToObservability: false,
  });

  if (!generation.ok) {
    throw new Error("Try-on generation failed.");
  }

  return {
    imageBase64: generation.imageBase64,
    providerRequestId: generation.providerRequestId,
  };
}

export async function uploadResultForWorker(input: {
  session: TryOnSessionRow;
  imageBase64: string;
}): Promise<string> {
  const resultPath = buildResultStoragePath(input.session.brand_id, input.session.id);
  const resultBuffer = Buffer.from(input.imageBase64, "base64");
  const uploaded = await uploadTryOnResult(resultPath, resultBuffer);

  if (!uploaded) {
    throw new Error("Generated result could not be stored.");
  }

  return resultPath;
}

export async function persistResultPathForWorker(sessionId: string, resultPath: string): Promise<void> {
  const pathSaved = await setSessionResultPath(sessionId, resultPath);

  if (!pathSaved) {
    await removeTryOnResult(resultPath);
    throw new Error("Generated result could not be saved.");
  }
}

export async function persistTryOnResultForWorker(input: {
  session: TryOnSessionRow;
  imageBase64: string;
}): Promise<string> {
  const resultPath = await uploadResultForWorker(input);
  await persistResultPathForWorker(input.session.id, resultPath);
  return resultPath;
}

export async function consumeCreditsForWorker(sessionId: string): Promise<void> {
  const consumeResult = await callConsumeReservedBrandCredits(sessionId);

  if (consumeResult.error) {
    throw new Error("Try-on could not be finalized.");
  }
}

export async function compensateFailedGeneration(input: {
  sessionId: string;
  resultPath?: string | null;
  errorCode: string;
  sanitizedErrorMessage: string;
}): Promise<void> {
  if (input.resultPath) {
    await removeTryOnResult(input.resultPath);
  }

  await callReleaseReservedBrandCredits(input.sessionId);
  await markSessionFailed(input.sessionId, input.errorCode, input.sanitizedErrorMessage);
}

export async function recordProviderRequestId(sessionId: string, providerRequestId: string | null) {
  if (!providerRequestId) {
    return;
  }

  await setSessionProviderRequestId(sessionId, providerRequestId);
}
