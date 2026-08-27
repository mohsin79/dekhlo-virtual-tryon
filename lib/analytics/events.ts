export const ANALYTICS_EVENTS = [
  "signup_started",
  "signup_completed",
  "brand_created",
  "product_created",
  "try_on_started",
  "try_on_completed",
  "try_on_failed",
  "lead_form_viewed",
  "lead_submitted",
  "dashboard_leads_viewed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export const ANALYTICS_SURFACES = ["auth", "dashboard", "try_on", "lead"] as const;
export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

export const ANALYTICS_OUTCOMES = ["started", "completed", "failed", "viewed", "submitted"] as const;
export type AnalyticsOutcome = (typeof ANALYTICS_OUTCOMES)[number];

export const TRY_ON_FAILURE_CATEGORIES = [
  "upload_failed",
  "validation_failed",
  "generation_failed",
  "credits_unavailable",
  "network_error",
  "unknown",
] as const;

export type TryOnFailureCategory = (typeof TRY_ON_FAILURE_CATEGORIES)[number];

export const APPROVED_ANALYTICS_PROPERTY_KEYS = [
  "surface",
  "outcome",
  "error_category",
  "consent_version",
  "route_group",
] as const;

export type ApprovedAnalyticsPropertyKey = (typeof APPROVED_ANALYTICS_PROPERTY_KEYS)[number];

export const FORBIDDEN_ANALYTICS_PROPERTY_KEYS = [
  "email",
  "phone",
  "name",
  "full_name",
  "sessionid",
  "session_id",
  "leadid",
  "lead_id",
  "brandid",
  "brand_id",
  "productid",
  "product_id",
  "userid",
  "user_id",
  "filename",
  "file_name",
  "image",
  "image_url",
  "signed_url",
  "storage_path",
  "search",
  "query",
  "reason",
  "message",
  "error_message",
  "idempotency_key",
  "token",
  "cookie",
  "url",
  "href",
] as const;

export type AnalyticsEventInput =
  | { event: "signup_started"; surface: "auth"; route_group: "/auth" }
  | { event: "signup_completed"; surface: "auth"; route_group: "/auth"; outcome: "completed" }
  | {
      event: "brand_created";
      surface: "dashboard";
      route_group: "/dashboard";
      outcome: "completed";
    }
  | {
      event: "product_created";
      surface: "dashboard";
      route_group: "/dashboard/products";
      outcome: "completed";
    }
  | {
      event: "try_on_started";
      surface: "try_on";
      route_group: "/try";
      outcome: "started";
    }
  | {
      event: "try_on_completed";
      surface: "try_on";
      route_group: "/try";
      outcome: "completed";
    }
  | {
      event: "try_on_failed";
      surface: "try_on";
      route_group: "/try";
      outcome: "failed";
      error_category: TryOnFailureCategory;
    }
  | {
      event: "lead_form_viewed";
      surface: "lead";
      route_group: "/try";
      outcome: "viewed";
    }
  | {
      event: "lead_submitted";
      surface: "lead";
      route_group: "/try";
      outcome: "submitted";
    }
  | {
      event: "dashboard_leads_viewed";
      surface: "dashboard";
      route_group: "/dashboard/leads";
      outcome: "viewed";
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePropertyKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

export function isForbiddenAnalyticsPropertyKey(key: string): boolean {
  const normalized = normalizePropertyKey(key);

  return FORBIDDEN_ANALYTICS_PROPERTY_KEYS.some(
    (forbidden) => normalized === forbidden || normalized.includes(forbidden),
  );
}

export function isApprovedAnalyticsPropertyKey(key: string): key is ApprovedAnalyticsPropertyKey {
  return (APPROVED_ANALYTICS_PROPERTY_KEYS as readonly string[]).includes(key);
}

function isSafeAnalyticsPropertyValue(value: unknown): value is string | number {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "string") {
    return false;
  }

  if (value.length === 0 || value.length > 64) {
    return false;
  }

  if (value.includes("@")) {
    return false;
  }

  if (UUID_PATTERN.test(value)) {
    return false;
  }

  if (/^https?:\/\//i.test(value)) {
    return false;
  }

  if (/^data:/i.test(value)) {
    return false;
  }

  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(value)) {
    return false;
  }

  if (/^sk-/i.test(value)) {
    return false;
  }

  return true;
}

export function sanitizeAnalyticsEventInput(
  input: AnalyticsEventInput,
  consentVersion: number,
): Record<ApprovedAnalyticsPropertyKey, string | number> | null {
  if (!isAnalyticsEventName(input.event)) {
    return null;
  }

  const allowedInputKeys = new Set(["event", "surface", "route_group", "outcome", "error_category"]);

  for (const key of Object.keys(input)) {
    if (!allowedInputKeys.has(key)) {
      return null;
    }
  }

  const properties: Partial<Record<ApprovedAnalyticsPropertyKey, string | number>> = {
    consent_version: consentVersion,
    surface: input.surface,
    route_group: input.route_group,
  };

  if ("outcome" in input) {
    properties.outcome = input.outcome;
  }

  if ("error_category" in input) {
    properties.error_category = input.error_category;
  }

  for (const [key, value] of Object.entries(properties)) {
    if (!isApprovedAnalyticsPropertyKey(key) || isForbiddenAnalyticsPropertyKey(key)) {
      return null;
    }

    if (!isSafeAnalyticsPropertyValue(value)) {
      return null;
    }
  }

  if (input.event === "try_on_failed" && !properties.error_category) {
    return null;
  }

  return properties as Record<ApprovedAnalyticsPropertyKey, string | number>;
}

export function mapTryOnClientFailureCategory(input: {
  phase?: string;
  message?: string;
}): TryOnFailureCategory {
  const message = input.message?.toLowerCase() ?? "";

  if (message.includes("credit")) {
    return "credits_unavailable";
  }

  if (message.includes("upload")) {
    return "upload_failed";
  }

  if (message.includes("validation") || input.phase === "photo_selected") {
    return "validation_failed";
  }

  if (message.includes("network") || message.includes("fetch")) {
    return "network_error";
  }

  if (input.phase === "polling" || input.phase === "error") {
    return "generation_failed";
  }

  return "unknown";
}
