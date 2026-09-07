import type { PostHogConfig } from "posthog-js";
import { applyPostHogEventFirewall } from "@/lib/analytics/posthog-firewall";

export function buildPostHogInitConfig(): Partial<PostHogConfig> {
  return {
    // Capture surfaces: Dekhlo sends explicit events only.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_scroll_properties: true,
    disableDeviceModel: true,

    // Feature flags are unused in V1.
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    advanced_disable_toolbar_metrics: true,

    // No campaign attribution or referrer collection in V1.
    save_referrer: false,
    save_campaign_params: false,

    // Dekhlo never calls identify()/alias(), so no person profiles are ever processed.
    person_profiles: "never",

    // localStorage only: consent is tracked by our own first-party cookie, so PostHog must not
    // add an analytics identity cookie.
    disable_persistence: false,
    persistence: "localStorage",

    // Last gate before the network request: drops non-allowlisted events and strips SDK metadata.
    before_send: applyPostHogEventFirewall,

    debug: false,
  };
}

export const POSTHOG_PRIVACY_INIT_FLAGS = {
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_heatmaps: false,
  capture_performance: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_scroll_properties: true,
  disableDeviceModel: true,
  advanced_disable_feature_flags: true,
  advanced_disable_feature_flags_on_first_load: true,
  advanced_disable_toolbar_metrics: true,
  save_referrer: false,
  save_campaign_params: false,
  person_profiles: "never",
  persistence: "localStorage",
} as const;
