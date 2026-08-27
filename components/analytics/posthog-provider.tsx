"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAnalyticsConsentCookie,
  readAnalyticsConsentFromDocument,
  writeAnalyticsConsentCookie,
} from "@/lib/analytics/consent-cookie";
import {
  capturePostHogEvent,
  initializePostHogClient,
  shutdownPostHogClient,
} from "@/lib/analytics/posthog-client";
import {
  setAnalyticsCaptureHandler,
  setAnalyticsConsentAccepted,
} from "@/lib/analytics/track";
import type { AnalyticsEventName } from "@/lib/analytics/events";
import type { AnalyticsConsentState } from "@/lib/analytics/consent";
import { AnalyticsConsentContext } from "@/components/analytics/analytics-consent-context";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<AnalyticsConsentState>(() =>
    typeof document === "undefined" ? "undecided" : readAnalyticsConsentFromDocument(),
  );

  const syncAcceptedState = useCallback((nextConsent: AnalyticsConsentState) => {
    if (nextConsent === "accepted") {
      const initialized = initializePostHogClient();

      if (initialized) {
        setAnalyticsConsentAccepted(true);
        setAnalyticsCaptureHandler(
          (eventName: AnalyticsEventName, properties: Record<string, string | number>) => {
            capturePostHogEvent(eventName, properties);
          },
        );
        return;
      }
    }

    shutdownPostHogClient();
    setAnalyticsConsentAccepted(false);
    setAnalyticsCaptureHandler(null);
  }, []);

  useEffect(() => {
    syncAcceptedState(consent);
  }, [consent, syncAcceptedState]);

  const acceptConsent = useCallback(() => {
    writeAnalyticsConsentCookie("accepted");
    setConsent("accepted");
  }, []);

  const declineConsent = useCallback(() => {
    writeAnalyticsConsentCookie("declined");
    shutdownPostHogClient();
    setAnalyticsConsentAccepted(false);
    setAnalyticsCaptureHandler(null);
    setConsent("declined");
  }, []);

  const resetConsent = useCallback(() => {
    clearAnalyticsConsentCookie();
    shutdownPostHogClient();
    setAnalyticsConsentAccepted(false);
    setAnalyticsCaptureHandler(null);
    setConsent("undecided");
  }, []);

  const value = useMemo(
    () => ({
      consent,
      acceptConsent,
      declineConsent,
      resetConsent,
    }),
    [acceptConsent, consent, declineConsent, resetConsent],
  );

  return <AnalyticsConsentContext.Provider value={value}>{children}</AnalyticsConsentContext.Provider>;
}
