"use client";

import { createContext, useContext } from "react";
import type { AnalyticsConsentState } from "@/lib/analytics/consent";

export type AnalyticsConsentContextValue = {
  consent: AnalyticsConsentState;
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
