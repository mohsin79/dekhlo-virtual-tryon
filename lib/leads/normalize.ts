import {
  LEAD_MAX_EMAIL_LENGTH,
  LEAD_MAX_FULL_NAME_LENGTH,
  LEAD_MAX_PHONE_DIGITS,
  LEAD_MAX_PHONE_STORED_LENGTH,
  LEAD_MIN_EMAIL_LENGTH,
  LEAD_MIN_PHONE_DIGITS,
} from "@/lib/leads/constants";

export function normalizeLeadFullName(value: string | undefined | null): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, LEAD_MAX_FULL_NAME_LENGTH);
}

export function normalizeLeadEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, LEAD_MAX_EMAIL_LENGTH);
}

export function normalizeLeadPhone(value: string | undefined | null): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const compact = trimmed.replace(/[\s\-()]/g, "");

  if (compact.includes("+") && !compact.startsWith("+")) {
    return null;
  }

  const normalized = compact.startsWith("+") ? `+${compact.slice(1).replace(/\D/g, "")}` : compact.replace(/\D/g, "");

  if (!/^\+?\d+$/.test(normalized)) {
    return null;
  }

  const digits = normalized.startsWith("+") ? normalized.slice(1) : normalized;

  if (digits.length < LEAD_MIN_PHONE_DIGITS || digits.length > LEAD_MAX_PHONE_DIGITS) {
    return null;
  }

  if (normalized.length > LEAD_MAX_PHONE_STORED_LENGTH) {
    return null;
  }

  return normalized;
}

export function isLeadEmailLengthValid(email: string): boolean {
  return email.length >= LEAD_MIN_EMAIL_LENGTH && email.length <= LEAD_MAX_EMAIL_LENGTH;
}
