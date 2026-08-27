export const ANALYTICS_CONSENT_COOKIE = "dekhlo-analytics-consent";
export const ANALYTICS_CONSENT_VERSION = 1;
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 31_536_000;

export type AnalyticsConsentState = "undecided" | "accepted" | "declined";

export type AnalyticsConsentDecision = "accepted" | "declined";

export type AnalyticsConsentRecord = {
  v: number;
  state: AnalyticsConsentDecision;
  at: string;
};

export function parseAnalyticsConsentCookie(
  raw: string | null | undefined,
): AnalyticsConsentState {
  if (!raw) {
    return "undecided";
  }

  try {
    const decoded = decodeURIComponent(raw.trim());
    const parsed = JSON.parse(decoded) as Partial<AnalyticsConsentRecord>;

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
