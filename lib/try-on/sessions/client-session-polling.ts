import {
  buildTryOnSessionStatusUrl,
  type TryOnSessionStatus,
} from "@/lib/try-on/sessions/session-restoration";
import {
  computeSessionPollDelayMs,
  shouldContinueSessionPolling,
} from "@/lib/try-on/sessions/session-polling";

export type SessionPollPayload = {
  status?: TryOnSessionStatus;
  resultUrl?: string | null;
  sanitizedErrorMessage?: string | null;
  error?: string;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollTryOnSessionUntilTerminal(input: {
  sessionId: string;
  brandSlug: string;
  productSlug: string;
  isCancelled: () => boolean;
  signal?: AbortSignal;
}): Promise<SessionPollPayload> {
  let attempt = 0;

  while (!input.isCancelled()) {
    if (input.signal?.aborted) {
      throw new Error("Try-on polling was cancelled.");
    }

    const response = await fetch(
      buildTryOnSessionStatusUrl(input.sessionId, input.brandSlug, input.productSlug),
      {
        method: "GET",
        cache: "no-store",
        signal: input.signal,
      },
    );

    const payload = (await response.json().catch(() => null)) as SessionPollPayload | null;

    if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
      throw new Error(payload?.error ?? "This session is no longer available.");
    }

    if (!response.ok && response.status !== 503) {
      throw new Error(payload?.error ?? "Unable to check try-on status.");
    }

    const status = payload?.status;

    if (status === "completed") {
      if (!payload?.resultUrl) {
        throw new Error("Try-on completed without a result.");
      }

      return payload;
    }

    if (status === "failed" || status === "cancelled") {
      throw new Error(payload?.sanitizedErrorMessage ?? payload?.error ?? "Try-on generation failed.");
    }

    if (status && !shouldContinueSessionPolling(status)) {
      throw new Error("Try-on is in an unexpected state.");
    }

    await sleep(computeSessionPollDelayMs(attempt));
    attempt += 1;
  }

  throw new Error("Try-on polling was cancelled.");
}
