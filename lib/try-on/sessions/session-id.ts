import { z } from "zod";

const tryOnSessionIdSchema = z.string().uuid();

/**
 * Malformed session ids are reported with the same message and status as a missing
 * session so callers cannot distinguish invalid input from a session that does not
 * exist. Mirrors the Phase 8B lead route contract.
 */
export const TRY_ON_SESSION_NOT_FOUND_MESSAGE = "Session not found.";

export function isValidTryOnSessionId(sessionId: string): boolean {
  return tryOnSessionIdSchema.safeParse(sessionId).success;
}
