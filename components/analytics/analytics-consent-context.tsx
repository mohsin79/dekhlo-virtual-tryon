"use client";

import { createContext, useContext } from "react";
import type { AnalyticsConsentState, AnalyticsConsentStatus } from "@/lib/analytics/consent";

export type AnalyticsConsentContextValue = {
  /** Includes the "resolving" hydration status. */
  status: AnalyticsConsentStatus;
  /** Resolved consent state, or null while the stored preference is still being read. */
  consent: AnalyticsConsentState | null;
  acceptConsent: () => void;
  declineConsent: () => void;
  resetConsent: () => void;
};

export const AnalyticsConsentContext = createContext<AnalyticsConsentContextValue | null>(null);

export function useAnalyticsConsent(): AnalyticsConsentContextValue {
  const value = useContext(AnalyticsConsentContext);

  if (!value) {
    throw new Error("useAnalyticsConsent must be used within PostHogProvider.");
  }

  return value;
}
