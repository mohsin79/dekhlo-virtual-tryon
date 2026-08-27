"use client";

import { Suspense } from "react";
import { AnalyticsConsentBanner } from "@/components/analytics/analytics-consent-banner";
import { PageviewTracker } from "@/components/analytics/pageview-tracker";
import { PostHogProvider } from "@/components/analytics/posthog-provider";

export function AnalyticsShell({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      {children}
      <AnalyticsConsentBanner />
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
    </PostHogProvider>
  );
}
