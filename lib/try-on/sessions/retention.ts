import {
  CONSENT_SESSION_TTL_DAYS,
  INCOMPLETE_SESSION_TTL_HOURS,
} from "@/lib/try-on/sessions/constants";

export function computeInitialSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INCOMPLETE_SESSION_TTL_HOURS * 60 * 60 * 1000);
}

export function computeCompletedSessionExpiry(consentToStore: boolean, now = new Date()): Date {
  if (consentToStore) {
    return new Date(now.getTime() + CONSENT_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  return new Date(now.getTime() + INCOMPLETE_SESSION_TTL_HOURS * 60 * 60 * 1000);
}
