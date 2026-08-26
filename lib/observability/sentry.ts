import "server-only";

import * as Sentry from "@sentry/nextjs";
import { getSentryDsn } from "@/lib/env";
import { shouldCaptureError } from "@/lib/observability/capture-policy";
import { sanitizeAllowlistedContext } from "@/lib/observability/sentry-scrub";

export type SentryContext = {
  routeCategory?: string;
  operation?: string;
  errorCategory?: string;
  sessionStatusClass?: string;
  inngestFunctionId?: string;
};

export type OperationalMessageCode =
  | "try_on_provider_not_configured"
  | "product_image_cleanup_failed";

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unexpected error");
}

export function isSentryEnabled(): boolean {
  return Boolean(getSentryDsn());
}

function applyAllowlistedContext(scope: Sentry.Scope, context: SentryContext): void {
  const sanitized = sanitizeAllowlistedContext(context as Record<string, unknown>);

  for (const [key, value] of Object.entries(sanitized)) {
    scope.setTag(key, value);
  }
}

export function captureUnexpectedError(
  error: unknown,
  context: SentryContext = {},
  httpStatus?: number,
): void {
  if (!isSentryEnabled()) {
    return;
  }

  if (!shouldCaptureError(error, httpStatus)) {
    return;
  }

  Sentry.withScope((scope) => {
    applyAllowlistedContext(scope, context);

    if (httpStatus !== undefined) {
      scope.setTag("httpStatus", String(httpStatus));
    }

    Sentry.captureException(normalizeError(error));
  });
}

export function captureOperationalMessage(
  messageCode: OperationalMessageCode,
  context: SentryContext = {},
): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    applyAllowlistedContext(scope, context);
    scope.setTag("messageCode", messageCode);
    Sentry.captureMessage(messageCode, "warning");
  });
}

export function captureUnexpectedHttpFailure(
  error: unknown,
  status: number,
  context: SentryContext = {},
): void {
  if (!shouldCaptureError(error, status)) {
    return;
  }

  captureUnexpectedError(error, context, status);
}
