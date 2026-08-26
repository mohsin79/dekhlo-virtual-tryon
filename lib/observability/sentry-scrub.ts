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

/** Sentry contexts derived from browser/client requests — never send. */
const REMOVED_CONTEXT_KEYS = new Set([
  "browser",
  "client_os",
  "device",
  "culture",
  "locale",
  "timezone",
  "geo",
  "user_agent",
  "os",
  "client",
]);

const BREADCRUMB_DATA_KEYS_TO_REMOVE = new Set([
  "headers",
  "request_headers",
  "response_headers",
  "body",
  "request_body",
  "response_body",
  "cookie",
  "cookies",
  "authorization",
  "set-cookie",
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

export function sanitizeRequestPath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "http://localhost");
    return url.pathname || "/";
  } catch {
    return REDACTED;
  }
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

  const method =
    typeof event.request.method === "string" ? event.request.method.toUpperCase() : undefined;
  const path =
    typeof event.request.url === "string" ? sanitizeRequestPath(event.request.url) : undefined;

  event.request = {};

  if (method) {
    event.request.method = method;
  }

  if (path) {
    event.request.url = path;
  }
}

function scrubUserData(event: SentryEvent): void {
  delete event.user;
}

function scrubServerIdentity(event: SentryEvent): void {
  delete event.server_name;
}

function scrubRuntimeContext(contexts: NonNullable<SentryEvent["contexts"]>): void {
  const runtime = contexts.runtime;

  if (!runtime || typeof runtime !== "object") {
    return;
  }

  const safeRuntime: Record<string, string> = {};

  if (typeof runtime.name === "string" && runtime.name.length > 0) {
    safeRuntime.name = runtime.name;
  }

  if (typeof runtime.version === "string" && runtime.version.length > 0) {
    safeRuntime.version = runtime.version;
  }

  contexts.runtime = safeRuntime;
}

function scrubContexts(event: SentryEvent): void {
  if (!event.contexts) {
    return;
  }

  for (const key of REMOVED_CONTEXT_KEYS) {
    delete event.contexts[key];
  }

  scrubRuntimeContext(event.contexts);

  for (const [key, value] of Object.entries(event.contexts)) {
    if (REMOVED_CONTEXT_KEYS.has(key) || key === "runtime") {
      continue;
    }

    event.contexts[key] = deepScrub(value) as (typeof event.contexts)[string];
  }
}

function scrubBreadcrumbData(
  breadcrumb: NonNullable<SentryEvent["breadcrumbs"]>[number],
): Record<string, unknown> | undefined {
  if (!breadcrumb.data) {
    return undefined;
  }

  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(breadcrumb.data)) {
    const normalizedKey = key.toLowerCase();

    if (BREADCRUMB_DATA_KEYS_TO_REMOVE.has(normalizedKey) || isSensitiveKey(key)) {
      continue;
    }

    if (normalizedKey === "url" && typeof value === "string") {
      data[key] = sanitizeRequestPath(value);
      continue;
    }

    if (breadcrumb.category === "console") {
      const scrubbed = deepScrub(value);

      if (scrubbed === REDACTED) {
        continue;
      }

      data[key] = scrubbed;
      continue;
    }

    data[key] = deepScrub(value);
  }

  return Object.keys(data).length > 0 ? data : undefined;
}

export function scrubBreadcrumb(
  breadcrumb: NonNullable<SentryEvent["breadcrumbs"]>[number],
): NonNullable<SentryEvent["breadcrumbs"]>[number] {
  const scrubbed: NonNullable<SentryEvent["breadcrumbs"]>[number] = {
    category: breadcrumb.category,
    type: breadcrumb.type,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
  };

  if (typeof breadcrumb.message === "string") {
    scrubbed.message = truncateString(deepScrub(breadcrumb.message) as string);
  }

  const data = scrubBreadcrumbData(breadcrumb);

  if (data) {
    scrubbed.data = data;
  }

  return scrubbed;
}

function scrubBreadcrumbs(event: SentryEvent): void {
  if (!event.breadcrumbs) {
    return;
  }

  event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => scrubBreadcrumb(breadcrumb));
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
    scrubContexts(event);
  }

  if (event.tags) {
    event.tags = sanitizeAllowlistedContext(event.tags as Record<string, unknown>);
  }
}

export function scrubSentryEvent(event: SentryEvent): SentryEvent {
  scrubServerIdentity(event);
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

