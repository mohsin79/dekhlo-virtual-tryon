import "server-only";

import {
  readSessionAccessToken,
  tokensMatch,
} from "@/lib/try-on/sessions/tokens";
import {
  getSessionById,
  isSessionDeleted,
  isSessionExpired,
  type TryOnSessionRow,
} from "@/lib/try-on/sessions/service";

export type AuthorizedSession = {
  session: TryOnSessionRow;
};

export async function authorizeSessionAccess(
  sessionId: string,
): Promise<{ ok: true; value: AuthorizedSession } | { ok: false; status: number; message: string }> {
  const token = await readSessionAccessToken(sessionId);

  if (!token) {
    return { ok: false, status: 401, message: "Session access is required." };
  }

  const session = await getSessionById(sessionId);

  if (!session) {
    return { ok: false, status: 404, message: "Session not found." };
  }

  if (isSessionDeleted(session) || isSessionExpired(session)) {
    return { ok: false, status: 410, message: "This session is no longer available." };
  }

  if (!tokensMatch(session.anonymous_token_hash, token)) {
    return { ok: false, status: 403, message: "Session access is invalid." };
  }

  return { ok: true, value: { session } };
}
