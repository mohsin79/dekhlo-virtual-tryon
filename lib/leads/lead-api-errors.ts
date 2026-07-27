import { LEAD_UNAVAILABLE_MESSAGE } from "@/lib/leads/constants";

export function mapLeadRpcError(message: string): { status: number; error: string } {
  const normalized = message.toUpperCase();

  if (normalized.includes("LEAD_SESSION_UNAVAILABLE")) {
    return { status: 404, error: LEAD_UNAVAILABLE_MESSAGE };
  }

  if (normalized.includes("LEAD_SESSION_EXPIRED")) {
    return { status: 410, error: "This try-on session is no longer available." };
  }

  if (normalized.includes("LEAD_SESSION_NOT_COMPLETED")) {
    return { status: 404, error: LEAD_UNAVAILABLE_MESSAGE };
  }

  if (normalized.includes("LEAD_CONFLICT")) {
    return { status: 409, error: "A lead was already submitted for this try-on." };
  }

  if (normalized.includes("LEAD_CONSENT_REQUIRED")) {
    return { status: 422, error: "Contact consent is required." };
  }

  if (normalized.includes("LEAD_INVALID_INPUT")) {
    return { status: 422, error: "Invalid lead submission." };
  }

  return { status: 500, error: "Unable to submit lead." };
}
