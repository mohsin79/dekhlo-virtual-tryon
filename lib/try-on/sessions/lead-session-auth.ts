import "server-only";

import { readSessionAccessToken, tokensMatch } from "@/lib/try-on/sessions/tokens";
import { getSessionById, type TryOnSessionRow } from "@/lib/try-on/sessions/service";
import { LEAD_UNAVAILABLE_MESSAGE } from "@/lib/leads/constants";

export type AuthorizedLeadSession = {
  session: TryOnSessionRow;
};

type LeadAuthFailure = {
  ok: false;
  status: number;
  message: string;
};

type LeadAuthSuccess = {
  ok: true;
  value: AuthorizedLeadSession;
};

/**
 * Enumeration-resistant authorization for lead capture.
 * Wrong token, missing session, and invalid session id share the same 404 message.
 * Expired or soft-deleted sessions with a valid token return 410.
 */
export async function authorizeTryOnSessionForLead(
  sessionId: string,
): Promise<LeadAuthSuccess | LeadAuthFailure> {
  const token = await readSessionAccessToken(sessionId);

  if (!token) {
    return { ok: false, status: 404, message: LEAD_UNAVAILABLE_MESSAGE };
  }

  const session = await getSessionById(sessionId);

  if (!session) {
    return { ok: false, status: 404, message: LEAD_UNAVAILABLE_MESSAGE };
  }

  if (!tokensMatch(session.anonymous_token_hash, token)) {
    return { ok: false, status: 404, message: LEAD_UNAVAILABLE_MESSAGE };
  }

  if (session.deleted_at != null || new Date(session.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      status: 410,
      message: "This try-on session is no longer available.",
    };
  }

  return { ok: true, value: { session } };
}
