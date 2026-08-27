import type { PostHogConfig } from "posthog-js";

export function buildPostHogInitConfig(): Partial<PostHogConfig> {
  return {
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
    capture_dead_clicks: false,
    disable_surveys: true,
    disable_persistence: false,
    persistence: "localStorage+cookie",
    debug: process.env.NODE_ENV === "development" ? false : false,
  };
}

export const POSTHOG_PRIVACY_INIT_FLAGS = {
  autocapture: false,
  capture_pageview: false,
  disable_session_recording: true,
  capture_dead_clicks: false,
  disable_surveys: true,
} as const;
