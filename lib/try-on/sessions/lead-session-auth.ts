import "server-only";

import { readSessionAccessToken } from "@/lib/try-on/sessions/tokens";
import { getSessionById, type TryOnSessionRow } from "@/lib/try-on/sessions/service";
import { evaluateLeadSessionAuthorization } from "@/lib/try-on/sessions/lead-session-auth-logic";

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
 * Missing session cookie → 401.
 * Wrong token, missing session row share the same 404 message (enumeration-resistant).
 * Expired or soft-deleted sessions with a valid token return 410.
 */
export async function authorizeTryOnSessionForLead(
  sessionId: string,
): Promise<LeadAuthSuccess | LeadAuthFailure> {
  const token = await readSessionAccessToken(sessionId);
  const session = await getSessionById(sessionId);

  const evaluation = evaluateLeadSessionAuthorization({
    token,
    session: session
      ? {
          anonymous_token_hash: session.anonymous_token_hash,
          deleted_at: session.deleted_at,
          expires_at: session.expires_at,
        }
      : null,
  });

  if (!evaluation.ok) {
    return evaluation;
  }

  if (!session) {
    return { ok: false, status: 404, message: "This request could not be completed." };
  }

  return { ok: true, value: { session } };
}
