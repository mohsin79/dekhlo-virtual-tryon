"use client";

import { useEffect } from "react";
import { consumePendingAnalyticsEvent } from "@/lib/analytics/pending-events";
import { trackAnalyticsEvent } from "@/lib/analytics/track";

export function OnboardingPendingAnalytics() {
  useEffect(() => {
    if (consumePendingAnalyticsEvent("signup_completed")) {
      trackAnalyticsEvent({
        event: "signup_completed",
        surface: "auth",
        route_group: "/auth",
        outcome: "completed",
      });
    }
  }, []);

  return null;
}

export function DashboardPendingAnalytics() {
  useEffect(() => {
    if (consumePendingAnalyticsEvent("brand_created")) {
      trackAnalyticsEvent({
        event: "brand_created",
        surface: "dashboard",
        route_group: "/dashboard",
        outcome: "completed",
      });
    }
  }, []);

  return null;
}

export function ProductsPendingAnalytics() {
  useEffect(() => {
    if (consumePendingAnalyticsEvent("product_created")) {
      trackAnalyticsEvent({
        event: "product_created",
        surface: "dashboard",
        route_group: "/dashboard/products",
        outcome: "completed",
      });
    }
  }, []);

  return null;
}

export function LeadsDashboardAnalytics() {
  useEffect(() => {
    trackAnalyticsEvent({
      event: "dashboard_leads_viewed",
      surface: "dashboard",
      route_group: "/dashboard/leads",
      outcome: "viewed",
    });
  }, []);

  return null;
}
