import type { CaptureResult } from "posthog-js";
import { ANALYTICS_EVENTS, APPROVED_ANALYTICS_PROPERTY_KEYS } from "@/lib/analytics/events";

/**
 * Global outbound event allowlist. posthog-js runs `before_send` on the fully-built event
 * immediately before the network request, and a null return aborts the send, so this is the last
 * gate every event must pass — including events the SDK generates on its own.
 */
export const POSTHOG_ALLOWED_OUTBOUND_EVENTS = ["$pageview", ...ANALYTICS_EVENTS] as const;

const ALLOWED_OUTBOUND_EVENTS = new Set<string>(POSTHOG_ALLOWED_OUTBOUND_EVENTS);

/**
 * Processing-control property, not a business analytics dimension. PostHog performs server-side
 * GeoIP enrichment from the request IP by default; this instructs it not to. It is forced on every
 * allowed outbound event and is deliberately not reachable through the application track() API.
 */
export const POSTHOG_GEOIP_DISABLE_PROPERTY = "$geoip_disable";

/**
 * Anonymous SDK fields required for ingestion, deduplication, or for keeping person processing
 * off. `token` and `distinct_id` are protected by posthog-js itself. `$session_id` is a rotating
 * PostHog-generated anonymous analytics identifier and is unrelated to Dekhlo try-on session
 * tokens. `$is_identified` and `$process_person_profile` must survive so that person profiles
 * stay disabled server-side.
 */
export const POSTHOG_RETAINED_SDK_PROPERTIES = [
  "token",
  "distinct_id",
  "$device_id",
  "$insert_id",
  "$time",
  "$timestamp",
  "$lib",
  "$lib_version",
  "$sdk_dist_channel",
  "$session_id",
  "$is_identified",
  "$process_person_profile",
  POSTHOG_GEOIP_DISABLE_PROPERTY,
] as const;

/**
 * Location fields PostHog can derive from the request IP, plus the raw IP override. Dekhlo never
 * sends these from the browser and never spoofs an IP; they are listed explicitly (rather than by
 * a `$geoip_` prefix rule) so the `$geoip_disable` control itself is not caught by the denylist.
 */
export const POSTHOG_GEOIP_ENRICHMENT_PROPERTIES = [
  "$ip",
  "$geoip_city_name",
  "$geoip_city_confidence",
  "$geoip_country_name",
  "$geoip_country_code",
  "$geoip_continent_name",
  "$geoip_continent_code",
  "$geoip_postal_code",
  "$geoip_postal_code_confidence",
  "$geoip_latitude",
  "$geoip_longitude",
  "$geoip_accuracy_radius",
  "$geoip_time_zone",
  "$geoip_subdivision_1_name",
  "$geoip_subdivision_1_code",
  "$geoip_subdivision_1_confidence",
  "$geoip_subdivision_2_name",
  "$geoip_subdivision_2_code",
  "$geoip_subdivision_2_confidence",
  "$geoip_subdivision_3_name",
  "$geoip_subdivision_3_code",
] as const;

/**
 * Exact names of PostHog SDK properties Dekhlo does not send. Every entry is a literal name, so
 * approved application properties can never be removed by accident.
 */
export const POSTHOG_SDK_PROPERTY_DENYLIST = [
  // Client / device fingerprinting
  "$raw_user_agent",
  "$os",
  "$os_version",
  "$browser",
  "$browser_version",
  "$browser_type",
  "$browser_language",
  "$browser_language_prefix",
  "$device",
  "$device_type",
  "$device_model",
  "$timezone",
  "$timezone_offset",
  // Screen and viewport geometry
  "$screen",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  // Raw location
  "$current_url",
  "$host",
  "$pathname",
  "$referrer",
  "$referring_domain",
  "$search_engine",
  "$external_click_url",
  "title",
  // Feature flag metadata
  "$active_feature_flags",
  "$enabled_feature_flags",
  "$override_feature_flags",
  "$override_feature_flag_payloads",
  "$flag_call_reported_session_id",
  // SDK debug / remote capability reporting
  "$initialization_time",
  "$initial_referrer_info",
  "$configured_session_timeout_ms",
  "$config_defaults",
  "$capture_rate_limit",
  "$lib_rate_limit_remaining_tokens",
  "$lib_custom_api_host",
  "$autocapture_disabled_server_side",
  "$exception_capture_enabled_server_side",
  "$dead_clicks_enabled_server_side",
  "$heatmaps_enabled_server_side",
  "$session_recording_enabled_server_side",
  "$logs_capture_enabled_server_side",
  "$product_tours_enabled_server_side",
  "$web_vitals_enabled_server_side",
  "$web_vitals_allowed_metrics",
  // Autocapture residue
  "$copy_autocapture",
  "$clipboard_text_length",
  // Per-tab and per-pageview correlation identifiers with no V1 purpose:
  // $window_id only feeds session recording (disabled) and toolbar metrics (disabled), and
  // $pageview_id only links $pageview to $pageleave (disabled).
  "$window_id",
  "$pageview_id",
] as const;

/**
 * Known PostHog SDK property namespaces. Every prefix is `$`-scoped, so these can never match an
 * approved application property such as `route_group` or `consent_version`.
 */
export const POSTHOG_SDK_PROPERTY_PREFIX_DENYLIST = [
  "$session_entry_",
  "$prev_pageview_",
  "$feature_flag",
  "$sdk_debug_",
  "$web_vitals",
  "$surveys_",
  "$posthog_sr_",
] as const;

const RETAINED_SDK_PROPERTIES = new Set<string>(POSTHOG_RETAINED_SDK_PROPERTIES);
const DENIED_SDK_PROPERTIES = new Set<string>([
  ...POSTHOG_SDK_PROPERTY_DENYLIST,
  ...POSTHOG_GEOIP_ENRICHMENT_PROPERTIES,
]);
const APPROVED_APPLICATION_PROPERTIES = new Set<string>(APPROVED_ANALYTICS_PROPERTY_KEYS);

export function isAllowedOutboundPostHogEvent(eventName: string): boolean {
  return ALLOWED_OUTBOUND_EVENTS.has(eventName);
}

function isDeniedSdkProperty(key: string): boolean {
  if (DENIED_SDK_PROPERTIES.has(key)) {
    return true;
  }

  return POSTHOG_SDK_PROPERTY_PREFIX_DENYLIST.some((prefix) => key.startsWith(prefix));
}

/**
 * Two-stage sanitizer. The explicit denylist removes the known SDK metadata, then a closed-world
 * guard drops anything that is neither an approved application property nor a retained anonymous
 * ingestion field, so a future SDK property cannot leak by default.
 *
 * `$geoip_disable` is then forced to `true` rather than copied from the incoming event, so no
 * caller — application or SDK — can weaken it.
 */
export function sanitizePostHogEventProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties ?? {})) {
    if (key === POSTHOG_GEOIP_DISABLE_PROPERTY) {
      continue;
    }

    if (isDeniedSdkProperty(key)) {
      continue;
    }

    if (!APPROVED_APPLICATION_PROPERTIES.has(key) && !RETAINED_SDK_PROPERTIES.has(key)) {
      continue;
    }

    if (value === undefined) {
      continue;
    }

    sanitized[key] = value;
  }

  sanitized[POSTHOG_GEOIP_DISABLE_PROPERTY] = true;

  return sanitized;
}

/**
 * `before_send` implementation: drops every event outside the global allowlist, strips SDK
 * metadata from the events that remain, and stamps `$geoip_disable: true` on each one so no
 * capture call has to remember it. Person-property payloads are cleared as defense in depth
 * because Dekhlo never calls identify() or alias().
 */
export function applyPostHogEventFirewall(event: CaptureResult | null): CaptureResult | null {
  if (!event) {
    return null;
  }

  if (!isAllowedOutboundPostHogEvent(String(event.event))) {
    return null;
  }

  const sanitized: CaptureResult = {
    ...event,
    properties: sanitizePostHogEventProperties(event.properties),
  };

  delete sanitized.$set;
  delete sanitized.$set_once;
  delete sanitized.$unset;

  return sanitized;
}
