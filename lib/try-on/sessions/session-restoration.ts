import type { Database } from "@/lib/supabase/database.types";
import { shouldContinueSessionPolling } from "@/lib/try-on/sessions/session-polling";

export type TryOnSessionStatus = Database["public"]["Enums"]["try_on_session_status"];

const TRY_ON_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidTryOnSessionId(value: string | null | undefined): value is string {
  return typeof value === "string" && TRY_ON_SESSION_ID_PATTERN.test(value);
}

export function buildTryOnSessionStatusUrl(
  sessionId: string,
  brandSlug: string,
  productSlug: string,
): string {
  const params = new URLSearchParams({
    brandSlug,
    productSlug,
  });

  return `/api/try-on/sessions/${sessionId}?${params.toString()}`;
}

export type SessionRestoreOutcome =
  | { kind: "clear" }
  | { kind: "completed"; resultUrl: string; status: "completed" }
  | { kind: "resume_polling"; status: TryOnSessionStatus };

export function evaluateSessionRestoreResponse(input: {
  httpStatus: number;
  status?: TryOnSessionStatus | null;
  resultUrl?: string | null;
}): SessionRestoreOutcome {
  if (
    input.httpStatus === 401 ||
    input.httpStatus === 403 ||
    input.httpStatus === 404 ||
    input.httpStatus === 410
  ) {
    return { kind: "clear" };
  }

  if (!input.status) {
    return { kind: "clear" };
  }

  if (input.status === "completed") {
    if (!input.resultUrl) {
      return { kind: "clear" };
    }

    return { kind: "completed", resultUrl: input.resultUrl, status: "completed" };
  }

  if (shouldContinueSessionPolling(input.status)) {
    return { kind: "resume_polling", status: input.status };
  }

  return { kind: "clear" };
}
