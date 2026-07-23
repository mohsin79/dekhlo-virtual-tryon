export const AUTH_ERROR_REASONS = [
  "expired_or_used",
  "missing_callback",
  "confirmation_failed",
] as const;

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

const AUTH_ERROR_REASON_SET = new Set<string>(AUTH_ERROR_REASONS);

export function parseAuthErrorReason(value: string | null | undefined): AuthErrorReason {
  if (value && AUTH_ERROR_REASON_SET.has(value)) {
    return value as AuthErrorReason;
  }

  return "confirmation_failed";
}

export function authErrorPath(reason: AuthErrorReason): string {
  return `/auth/error?reason=${reason}`;
}

export function authErrorMessage(reason: AuthErrorReason): string {
  switch (reason) {
    case "missing_callback":
      return "This link is incomplete or invalid. Your email may already be confirmed. Try signing in with your email and password. If sign-in does not work, create an account again or request a new confirmation email.";
    case "expired_or_used":
    case "confirmation_failed":
    default:
      return "This link has expired or has already been used. Your email may already be confirmed. Try signing in with your email and password. If sign-in does not work, request a new confirmation email.";
  }
}

export function authErrorTitle(reason: AuthErrorReason): string {
  switch (reason) {
    case "missing_callback":
      return "Authentication link incomplete";
    case "expired_or_used":
      return "Authentication link unavailable";
    case "confirmation_failed":
    default:
      return "Authentication link could not be completed";
  }
}
