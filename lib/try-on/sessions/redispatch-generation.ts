import type { TryOnSessionStatus } from "@/lib/try-on/sessions/session-polling";

export const GENERATION_NOT_STARTED_MESSAGE =
  "Generation could not be started. Refresh this page to try again.";

/**
 * A queued session has reserved a credit but may not have reached Inngest.
 * Processing sessions already have a worker run, so a refresh must only poll.
 */
export function shouldRedispatchQueuedGeneration(
  status: TryOnSessionStatus | string | null | undefined,
): boolean {
  return status === "queued";
}

export class GenerationNotStartedError extends Error {
  constructor() {
    super(GENERATION_NOT_STARTED_MESSAGE);
    this.name = "GenerationNotStartedError";
  }
}

/**
 * Idempotent recovery for a queued session. The generate route sends the same
 * deterministic Inngest event id and does not reserve another credit.
 */
export async function redispatchQueuedGeneration(
  sessionId: string,
  status: TryOnSessionStatus | string | null | undefined,
  headers?: HeadersInit,
): Promise<void> {
  if (!shouldRedispatchQueuedGeneration(status)) {
    return;
  }

  const response = await fetch(`/api/try-on/sessions/${sessionId}/generate`, {
    method: "POST",
    headers,
  });

  // 409 means the session already moved on (completed, failed, or not queued).
  // Polling observes that state. 503 means the event was not accepted.
  if (response.status === 409) {
    return;
  }

  if (!response.ok) {
    throw new GenerationNotStartedError();
  }
}
