export const ANALYTICS_CONSENT_COOKIE = "dekhlo-analytics-consent";
export const ANALYTICS_CONSENT_VERSION = 1;
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 31_536_000;

export type AnalyticsConsentState = "undecided" | "accepted" | "declined";

export type AnalyticsConsentDecision = "accepted" | "declined";

/**
 * "resolving" is a hydration status, not a consent choice. The stored preference cannot be read
 * during a server or prerendered render, so consent is unknown until the client resolves the
 * cookie. "resolving" must never be treated as "undecided".
 */
export type AnalyticsConsentStatus = "resolving" | AnalyticsConsentState;

export type AnalyticsConsentRecord = {
  v: number;
  state: AnalyticsConsentDecision;
  at: string;
};

export type AnalyticsConsentLifecycleAction = "none" | "initialize" | "shutdown";

function decodeCookieValue(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed.includes("%")) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function stripCookieQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseAnalyticsConsentCookie(
  raw: string | null | undefined,
): AnalyticsConsentState {
  if (!raw) {
    return "undecided";
  }

  const candidate = stripCookieQuotes(decodeCookieValue(raw));

  try {
    const parsed = JSON.parse(candidate) as Partial<AnalyticsConsentRecord>;

    if (parsed.v !== ANALYTICS_CONSENT_VERSION) {
      return "undecided";
    }

    if (parsed.state === "accepted" || parsed.state === "declined") {
      return parsed.state;
    }

    return "undecided";
  } catch {
    return "undecided";
  }
}

/** The main consent prompt appears only when no valid stored preference exists. */
export function shouldShowMainConsentBanner(status: AnalyticsConsentStatus): boolean {
  return status === "undecided";
}

export function isAnalyticsConsentResolved(status: AnalyticsConsentStatus): boolean {
  return status !== "resolving";
}

export function describeAnalyticsPreference(status: AnalyticsConsentStatus): string {
  if (status === "accepted") {
    return "Analytics accepted";
  }

  if (status === "declined") {
    return "Analytics declined";
  }

  return "No analytics preference saved";
}

export function resolveConsentLifecycleAction(
  status: AnalyticsConsentStatus,
  isConfigured: boolean,
): AnalyticsConsentLifecycleAction {
  if (status === "resolving") {
    return "none";
  }

  if (status === "accepted" && isConfigured) {
    return "initialize";
  }

  return "shutdown";
}

export function serializeAnalyticsConsentRecord(state: AnalyticsConsentDecision): string {
  const record: AnalyticsConsentRecord = {
    v: ANALYTICS_CONSENT_VERSION,
    state,
    at: new Date().toISOString(),
  };

  return JSON.stringify(record);
}

export function buildAnalyticsConsentCookieHeader(
  state: AnalyticsConsentDecision,
  isProduction: boolean,
): string {
  const serialized = encodeURIComponent(serializeAnalyticsConsentRecord(state));
  const attributes = [
    `${ANALYTICS_CONSENT_COOKIE}=${serialized}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}`,
  ];

  if (isProduction) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function buildAnalyticsConsentClearCookieHeader(isProduction: boolean): string {
  const attributes = [`${ANALYTICS_CONSENT_COOKIE}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];

  if (isProduction) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function consentRecordContainsPii(record: AnalyticsConsentRecord): boolean {
  const serialized = JSON.stringify(record).toLowerCase();

  return (
    serialized.includes("@") ||
    serialized.includes("email") ||
    serialized.includes("phone") ||
    serialized.includes("uuid")
  );
}
