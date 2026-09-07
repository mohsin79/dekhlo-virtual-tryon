"use client";

import { useState } from "react";
import { useAnalyticsConsent } from "@/components/analytics/analytics-consent-context";
import {
  describeAnalyticsPreference,
  isAnalyticsConsentResolved,
} from "@/lib/analytics/consent";

export function AnalyticsPreferencesControl({ className }: { className?: string }) {
  const { status, acceptConsent, declineConsent } = useAnalyticsConsent();
  const [open, setOpen] = useState(false);

  if (!isAnalyticsConsentResolved(status)) {
    return null;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={className ?? "text-sm text-muted-foreground underline"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Analytics preferences
      </button>

      {open ? (
        <div
          className="space-y-2 rounded-lg border border-border/70 bg-surface/60 p-3"
          role="group"
          aria-label="Analytics preferences"
        >
          <p className="text-xs text-muted-foreground">{describeAnalyticsPreference(status)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary text-sm"
              disabled={status === "declined"}
              onClick={declineConsent}
            >
              Decline
            </button>
            <button
              type="button"
              className="btn btn-primary text-sm"
              disabled={status === "accepted"}
              onClick={acceptConsent}
            >
              Accept analytics
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
