"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAnalyticsConsent } from "@/components/analytics/analytics-consent-context";
import { capturePostHogPageview } from "@/lib/analytics/posthog-client";
import { isPostHogConfigured } from "@/lib/analytics/env";
import { sanitizePageviewPathname } from "@/lib/analytics/route-groups";

export function PageviewTracker() {
  const pathname = usePathname();
  const { consent } = useAnalyticsConsent();

  useEffect(() => {
    if (consent !== "accepted" || !isPostHogConfigured()) {
      return;
    }

    capturePostHogPageview(sanitizePageviewPathname(pathname));
  }, [consent, pathname]);

  return null;
}
