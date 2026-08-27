import posthog from "posthog-js";
import { ANALYTICS_CONSENT_VERSION } from "@/lib/analytics/consent";
import { isPostHogConfigured, getPostHogHost, getPostHogKey } from "@/lib/analytics/env";
import { buildPostHogInitConfig } from "@/lib/analytics/posthog-config";

let posthogInitialized = false;

export function isPostHogClientInitialized(): boolean {
  return posthogInitialized;
}

export function initializePostHogClient(): boolean {
  if (posthogInitialized || typeof window === "undefined" || !isPostHogConfigured()) {
    return posthogInitialized;
  }

  const key = getPostHogKey();
  const host = getPostHogHost();

  if (!key || !host) {
    return false;
  }

  posthog.init(key, {
    api_host: host,
    ...buildPostHogInitConfig(),
  });

  posthogInitialized = true;
  return true;
}

export function shutdownPostHogClient(): void {
  if (typeof window === "undefined" || !posthogInitialized) {
    posthogInitialized = false;
    return;
  }

  posthog.opt_out_capturing();
  posthog.reset();
  posthogInitialized = false;
}

export function capturePostHogEvent(
  eventName: string,
  properties: Record<string, string | number>,
): void {
  if (!posthogInitialized) {
    return;
  }

  posthog.capture(eventName, {
    ...properties,
    consent_version: ANALYTICS_CONSENT_VERSION,
  });
}

export function capturePostHogPageview(routeGroup: string): void {
  if (!posthogInitialized) {
    return;
  }

  posthog.capture("$pageview", {
    route_group: routeGroup,
    consent_version: ANALYTICS_CONSENT_VERSION,
  });
}

export function __resetPostHogClientStateForTests(): void {
  posthogInitialized = false;
}
