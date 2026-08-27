import {
  ANALYTICS_CONSENT_COOKIE,
  buildAnalyticsConsentClearCookieHeader,
  buildAnalyticsConsentCookieHeader,
  parseAnalyticsConsentCookie,
  type AnalyticsConsentDecision,
  type AnalyticsConsentState,
} from "@/lib/analytics/consent";

function readAnalyticsConsentCookieValue(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${ANALYTICS_CONSENT_COOKIE}=`;
  const cookies = document.cookie.split(";");

  for (const entry of cookies) {
    const trimmed = entry.trim();

    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return null;
}

export function readAnalyticsConsentFromDocument(): AnalyticsConsentState {
  return parseAnalyticsConsentCookie(readAnalyticsConsentCookieValue());
}

export function writeAnalyticsConsentCookie(state: AnalyticsConsentDecision): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = buildAnalyticsConsentCookieHeader(
    state,
    process.env.NODE_ENV === "production",
  );
}

export function clearAnalyticsConsentCookie(): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = buildAnalyticsConsentClearCookieHeader(
    process.env.NODE_ENV === "production",
  );
}
