"use client";

import { useAnalyticsConsent } from "@/components/analytics/analytics-consent-context";

export function AnalyticsPreferencesControl({ className }: { className?: string }) {
  const { resetConsent } = useAnalyticsConsent();

  return (
    <button
      type="button"
      className={className ?? "text-sm text-muted-foreground underline"}
      onClick={resetConsent}
    >
      Analytics preferences
    </button>
  );
}
