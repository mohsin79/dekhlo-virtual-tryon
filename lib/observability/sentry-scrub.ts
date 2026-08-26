import type { Event as SentryEvent } from "@sentry/core";
import { shouldCaptureHttpStatus } from "@/lib/observability/capture-policy";

const REDACTED = "[redacted]";

const SENSITIVE_KEY_FRAGMENTS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "sessiontoken",
  "session_token",
  "tokenhash",
  "secret",
  "apikey",
  "api_key",
  "password",
  "signedurl",
  "signed_url",
  "personstoragepath",
  "resultstoragepath",
  "storagepath",
  "email",
  "phone",
  "fullname",
  "idempotencykey",
  "requestbody",
  "body",
] as const;

const ALLOWLISTED_CONTEXT_KEYS = new Set([
  "routeCategory",
  "operation",
  "errorCategory",
  "sessionStatusClass",
  "inngestFunctionId",
  "messageCode",
]);

const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "session_token",
  "api_key",
  "apikey",
  "signature",
  "sig",
  "secret",
  "password",
  "email",
  "phone",
]);

export const SCRUB_LIMITS = {
  maxDepth: 8,
  maxKeys: 64,
  maxStringLength: 512,
  maxArrayLength: 32,
} as const;

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  return SENSITIVE_KEY_FRAGMENTS.some(
    (fragment) => normalized === fragment || normalized.includes(fragment),
  );
}

function truncateString(value: string): string {
  if (value.length <= SCRUB_LIMITS.maxStringLength) {
    return value;
  }

  return `${value.slice(0, SCRUB_LIMITS.maxStringLength)}…`;
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const sanitizedParams = new URLSearchParams();

    url.searchParams.forEach((value, key) => {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        sanitizedParams.set(key, REDACTED);
        return;
      }

      if (/token|secret|signature|signed|key/i.test(key)) {
        sanitizedParams.set(key, REDACTED);
        return;
      }

      sanitizedParams.set(key, truncateString(value));
    });

    url.search = sanitizedParams.toString();
    return url.toString();
  } catch {
    return REDACTED;
  }
}

type ScrubState = {
  depth: number;
  keyCount: number;
};

export function deepScrub<T>(value: T, state: ScrubState = { depth: 0, keyCount: 0 }): T {
  if (state.depth > SCRUB_LIMITS.maxDepth) {
    return REDACTED as T;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.startsWith("data:") && value.includes("base64,")) {
      return REDACTED as T;
    }

    if (value.startsWith("http://") || value.startsWith("https://")) {
      return sanitizeUrl(value) as T;
    }

    return truncateString(value) as T;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, SCRUB_LIMITS.maxArrayLength)
      .map((entry) => deepScrub(entry, { depth: state.depth + 1, keyCount: state.keyCount })) as T;
  }

  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (state.keyCount >= SCRUB_LIMITS.maxKeys) {
      break;
    }

    state.keyCount += 1;

    if (isSensitiveKey(key)) {
      output[key] = REDACTED;
      continue;
    }

    output[key] = deepScrub(entry, { depth: state.depth + 1, keyCount: state.keyCount });
  }

  return output as T;
}

export function sanitizeAllowlistedContext(
  context: Record<string, unknown>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWLISTED_CONTEXT_KEYS.has(key)) {
      continue;
    }

    if (typeof value === "string" && value.length > 0) {
      sanitized[key] = truncateString(value);
    }
  }

  return sanitized;
}

function scrubRequestData(event: SentryEvent): void {
  if (!event.request) {
    return;
  }

  delete event.request.cookies;
  delete event.request.data;
  delete (event.request as { body?: unknown }).body;

  if (event.request.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (isSensitiveKey(key)) {
        event.request.headers[key] = REDACTED;
      }
    }
  }

  if (typeof event.request.url === "string") {
    event.request.url = sanitizeUrl(event.request.url);
  }
}

function scrubUserData(event: SentryEvent): void {
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
    delete event.user.name;
  }
}

function scrubBreadcrumbs(event: SentryEvent): void {
  if (!event.breadcrumbs) {
    return;
  }

  event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
    const scrubbed = deepScrub(breadcrumb) as typeof breadcrumb;

    if (typeof scrubbed.data?.url === "string") {
      scrubbed.data.url = sanitizeUrl(scrubbed.data.url);
    }

    return scrubbed;
  });
}

function scrubExtraContext(event: SentryEvent): void {
  if (event.extra) {
    const allowlisted: Record<string, unknown> = {};

    for (const key of ALLOWLISTED_CONTEXT_KEYS) {
      if (key in event.extra) {
        allowlisted[key] = event.extra[key];
      }
    }

    event.extra = sanitizeAllowlistedContext(allowlisted as Record<string, unknown>);
  }

  if (event.contexts) {
    event.contexts = deepScrub(event.contexts) as SentryEvent["contexts"];
  }

  if (event.tags) {
    event.tags = sanitizeAllowlistedContext(event.tags as Record<string, unknown>);
  }
}

export function scrubSentryEvent(event: SentryEvent): SentryEvent {
  scrubRequestData(event);
  scrubUserData(event);
  scrubBreadcrumbs(event);
  scrubExtraContext(event);

  if (event.message) {
    event.message = truncateString(event.message);
  }

  return event;
}

export function shouldDropSentryEvent(event: SentryEvent): boolean {
  const statusTag = event.tags?.httpStatus;

  if (typeof statusTag === "string") {
    const status = Number.parseInt(statusTag, 10);

    if (Number.isFinite(status) && !shouldCaptureHttpStatus(status)) {
      return true;
    }
  }

  const fingerprint = event.fingerprint?.join(" ") ?? "";

  if (fingerprint.includes("expected_application_error")) {
    return true;
  }

  return false;
}

