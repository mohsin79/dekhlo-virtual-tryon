import type { Database } from "@/lib/supabase/database.types";

export type TryOnSessionStatus = Database["public"]["Enums"]["try_on_session_status"];

const UPLOAD_REUSABLE_STATUS: TryOnSessionStatus = "pending_upload";

export function isSessionUploadReusable(status: TryOnSessionStatus): boolean {
  return status === UPLOAD_REUSABLE_STATUS;
}

export type ProductTryOnPhase =
  | "idle"
  | "awaiting_new_photo"
  | "photo_selected"
  | "creating"
  | "optimizing"
  | "uploading"
  | "validating"
  | "polling"
  | "done"
  | "error";

/** Whether POST /api/try-on/sessions should use a fresh clientRequestId for this attempt. */
export function shouldMintNewClientRequestId(input: {
  phase: ProductTryOnPhase;
  sessionStatus: TryOnSessionStatus | null;
}): boolean {
  if (input.phase === "done") {
    return true;
  }

  if (input.phase === "photo_selected") {
    if (input.sessionStatus && !isSessionUploadReusable(input.sessionStatus)) {
      return true;
    }
  }

  if (input.phase === "error" && input.sessionStatus && !isSessionUploadReusable(input.sessionStatus)) {
    return true;
  }

  return false;
}

/** Whether UI reset should clear attempt identifiers (not used on “choose another photo” alone). */
export function shouldResetAttemptOnPhotoChange(input: {
  phase: ProductTryOnPhase;
  sessionStatus: TryOnSessionStatus | null;
}): boolean {
  if (input.phase === "done") {
    return false;
  }

  if (input.sessionStatus && !isSessionUploadReusable(input.sessionStatus)) {
    return input.phase !== "awaiting_new_photo";
  }

  return false;
}
