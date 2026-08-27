"use client";

import { useAnalyticsConsent } from "@/components/analytics/analytics-consent-context";

export function AnalyticsConsentBanner() {
  const { consent, acceptConsent, declineConsent } = useAnalyticsConsent();

  if (consent !== "undecided") {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-surface/95 p-4 shadow-lg backdrop-blur-sm"
      role="region"
      aria-label="Analytics consent"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          Dekhlo uses optional analytics to understand product usage and improve the experience. We
          do not include your uploaded photos, lead details, or other personal form data in
          analytics.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={declineConsent}>
            Decline
          </button>
          <button type="button" className="btn btn-primary" onClick={acceptConsent}>
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}
