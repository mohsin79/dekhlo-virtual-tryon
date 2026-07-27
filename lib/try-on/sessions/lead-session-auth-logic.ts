import { LEAD_UNAVAILABLE_MESSAGE } from "@/lib/leads/constants";
import { tokensMatch } from "@/lib/try-on/sessions/token-crypto";

export type LeadSessionAuthInput = {
  token: string | null;
  session: {
    anonymous_token_hash: string;
    deleted_at: string | null;
    expires_at: string;
  } | null;
};

export type LeadSessionAuthEvaluation =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function evaluateLeadSessionAuthorization(input: LeadSessionAuthInput): LeadSessionAuthEvaluation {
  if (!input.token) {
    return { ok: false, status: 401, message: "Session access is required." };
  }

  if (!input.session) {
    return { ok: false, status: 404, message: LEAD_UNAVAILABLE_MESSAGE };
  }

  if (!tokensMatch(input.session.anonymous_token_hash, input.token)) {
    return { ok: false, status: 404, message: LEAD_UNAVAILABLE_MESSAGE };
  }

  if (input.session.deleted_at != null || new Date(input.session.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      status: 410,
      message: "This try-on session is no longer available.",
    };
  }

  return { ok: true };
}
