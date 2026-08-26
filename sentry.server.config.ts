import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/core";
import { getSentryDsn, getSentryEnvironment, getSentryRelease } from "@/lib/env";
import { isExpectedApplicationError } from "@/lib/observability/capture-policy";
import { scrubSentryEvent, shouldDropSentryEvent } from "@/lib/observability/sentry-scrub";

const dsn = getSentryDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
      const originalError = hint.originalException;

      if (isExpectedApplicationError(originalError)) {
        return null;
      }

      if (shouldDropSentryEvent(event)) {
        return null;
      }

      return scrubSentryEvent(event) as ErrorEvent;
    },
  });
}
