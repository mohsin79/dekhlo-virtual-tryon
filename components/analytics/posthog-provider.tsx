"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  capturePostHogEvent,
  initializePostHogClient,
  shutdownPostHogClient,
} from "@/lib/analytics/posthog-client";
import {
  setAnalyticsCaptureHandler,
  setAnalyticsConsentAccepted,
} from "@/lib/analytics/track";
import { isPostHogConfigured } from "@/lib/analytics/env";
import type { AnalyticsEventName } from "@/lib/analytics/events";
import { resolveConsentLifecycleAction } from "@/lib/analytics/consent";
import {
  clearAnalyticsConsentDecision,
  getAnalyticsConsentServerSnapshot,
  getAnalyticsConsentSnapshot,
  recordAnalyticsConsentDecision,
  subscribeToAnalyticsConsent,
} from "@/lib/analytics/consent-store";
import { AnalyticsConsentContext } from "@/components/analytics/analytics-consent-context";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Server and prerendered renders cannot read the cookie, so consent starts as "resolving"
  // rather than "undecided". The stored preference is adopted right after hydration, which keeps
  // a valid accepted/declined choice intact across refresh with no consent-banner flash.
  const status = useSyncExternalStore(
    subscribeToAnalyticsConsent,
    getAnalyticsConsentSnapshot,
    getAnalyticsConsentServerSnapshot,
  );

  const disableAnalytics = useCallback(() => {
    shutdownPostHogClient();
    setAnalyticsConsentAccepted(false);
    setAnalyticsCaptureHandler(null);
  }, []);

  useEffect(() => {
    const action = resolveConsentLifecycleAction(status, isPostHogConfigured());

    if (action === "none") {
      return;
    }

    if (action === "initialize" && initializePostHogClient()) {
      setAnalyticsConsentAccepted(true);
      setAnalyticsCaptureHandler(
        (eventName: AnalyticsEventName, properties: Record<string, string | number>) => {
          capturePostHogEvent(eventName, properties);
        },
      );
      return;
    }

    disableAnalytics();
  }, [disableAnalytics, status]);

  const acceptConsent = useCallback(() => {
    recordAnalyticsConsentDecision("accepted");
  }, []);

  const declineConsent = useCallback(() => {
    recordAnalyticsConsentDecision("declined");
    disableAnalytics();
  }, [disableAnalytics]);

  const resetConsent = useCallback(() => {
    clearAnalyticsConsentDecision();
    disableAnalytics();
  }, [disableAnalytics]);

  const value = useMemo(
    () => ({
      status,
      consent: status === "resolving" ? null : status,
      acceptConsent,
      declineConsent,
      resetConsent,
    }),
    [acceptConsent, declineConsent, resetConsent, status],
  );

  return <AnalyticsConsentContext.Provider value={value}>{children}</AnalyticsConsentContext.Provider>;
}
