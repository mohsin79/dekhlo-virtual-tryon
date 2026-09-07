import {
  clearAnalyticsConsentCookie,
  readAnalyticsConsentFromDocument,
  writeAnalyticsConsentCookie,
} from "@/lib/analytics/consent-cookie";
import type { AnalyticsConsentDecision, AnalyticsConsentStatus } from "@/lib/analytics/consent";

/**
 * The consent cookie is the single source of truth. Exposing it as an external store lets React
 * render "resolving" on the server and during hydration, then adopt the stored preference in a
 * controlled post-hydration read instead of a hydration mismatch or a stale "undecided" render.
 */
const listeners = new Set<() => void>();

let cachedStatus: AnalyticsConsentStatus | null = null;

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToAnalyticsConsent(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getAnalyticsConsentSnapshot(): AnalyticsConsentStatus {
  if (typeof document === "undefined") {
    return "resolving";
  }

  if (cachedStatus === null) {
    cachedStatus = readAnalyticsConsentFromDocument();
  }

  return cachedStatus;
}

export function getAnalyticsConsentServerSnapshot(): AnalyticsConsentStatus {
  return "resolving";
}

export function recordAnalyticsConsentDecision(decision: AnalyticsConsentDecision): void {
  writeAnalyticsConsentCookie(decision);
  cachedStatus = decision;
  notifyListeners();
}

export function clearAnalyticsConsentDecision(): void {
  clearAnalyticsConsentCookie();
  cachedStatus = "undecided";
  notifyListeners();
}

export function __resetAnalyticsConsentStoreForTests(): void {
  cachedStatus = null;
  listeners.clear();
}
