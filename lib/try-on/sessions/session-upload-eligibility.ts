import type { Database } from "@/lib/supabase/database.types";

export type TryOnSessionStatus = Database["public"]["Enums"]["try_on_session_status"];

const UPLOAD_REUSABLE_STATUS: TryOnSessionStatus = "pending_upload";

export function isSessionUploadReusable(status: TryOnSessionStatus): boolean {
  return status === UPLOAD_REUSABLE_STATUS;
}

export type ProductTryOnPhase =
  | "idle"
  | "creating"
  | "optimizing"
  | "uploading"
  | "validating"
  | "generating"
  | "done"
  | "error";

/** Whether the UI should mint a fresh clientRequestId before POST /api/try-on/sessions. */
export function shouldMintNewClientRequestId(input: {
  phase: ProductTryOnPhase;
  sessionStatus: TryOnSessionStatus | null;
}): boolean {
  if (input.phase === "done") {
    return true;
  }

  if (input.phase === "error" && input.sessionStatus && !isSessionUploadReusable(input.sessionStatus)) {
    return true;
  }

  return false;
}

/** Whether selecting/replacing the person photo should reset attempt state. */
export function shouldResetAttemptOnPhotoChange(input: {
  phase: ProductTryOnPhase;
  sessionStatus: TryOnSessionStatus | null;
}): boolean {
  if (input.phase === "done") {
    return true;
  }

  if (input.sessionStatus && !isSessionUploadReusable(input.sessionStatus)) {
    return true;
  }

  return false;
}
