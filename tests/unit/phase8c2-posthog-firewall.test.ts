import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CaptureResult } from "posthog-js";
import {
  ANALYTICS_EVENTS,
  APPROVED_ANALYTICS_PROPERTY_KEYS,
  sanitizeAnalyticsEventInput,
} from "@/lib/analytics/events";
import { buildPostHogInitConfig } from "@/lib/analytics/posthog-config";
import {
  POSTHOG_ALLOWED_OUTBOUND_EVENTS,
  POSTHOG_GEOIP_DISABLE_PROPERTY,
  POSTHOG_GEOIP_ENRICHMENT_PROPERTIES,
  applyPostHogEventFirewall,
  isAllowedOutboundPostHogEvent,
  sanitizePostHogEventProperties,
} from "@/lib/analytics/posthog-firewall";

const ROOT = process.cwd();

function walkSourceFiles(directory: string): string[] {
  const skipped = new Set(["node_modules", ".next", ".git", "supabase", "docs", "public"]);
  const results: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (skipped.has(entry)) {
      continue;
    }

    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      results.push(...walkSourceFiles(path));
      continue;
    }

    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      results.push(path);
    }
  }

  return results;
}

function captureResult(event: string, properties: Record<string, unknown> = {}): CaptureResult {
  return {
    uuid: "0192f0c0-0000-7000-8000-000000000000",
    event,
    properties,
  } as CaptureResult;
}

/** Mirrors the observed live $pageview payload plus every property flagged for hardening. */
function livePageviewPayload(): Record<string, unknown> {
  return {
    // Application properties
    route_group: "/",
    consent_version: 1,

    // Required anonymous ingestion fields
    token: "phc_live_key",
    distinct_id: "0192f0c0-1111-7000-8000-000000000000",
    $device_id: "0192f0c0-2222-7000-8000-000000000000",
    $insert_id: "abc123",
    $time: 1_767_000_000,
    $lib: "web",
    $lib_version: "1.421.2",
    $sdk_dist_channel: "npm",
    $session_id: "0192f0c0-3333-7000-8000-000000000000",
    $is_identified: false,
    $process_person_profile: false,

    // Client / device fingerprinting
    $raw_user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0.0.0",
    $os: "Mac OS X",
    $os_version: "10.15.7",
    $browser: "Chrome",
    $browser_version: 141,
    $browser_language: "en-GB",
    $browser_language_prefix: "en",
    $device_type: "Desktop",
    $device_model: "Pixel 7",
    $timezone: "Asia/Karachi",
    $timezone_offset: -300,

    // Screen and viewport
    $screen_height: 1080,
    $screen_width: 1920,
    $viewport_height: 900,
    $viewport_width: 1680,

    // Raw location
    $current_url: "http://localhost:3000/try/acme-brand/red-dress?utm_source=newsletter",
    $host: "localhost:3000",
    $pathname: "/try/acme-brand/red-dress",
    $referrer: "https://www.google.com/",
    $referring_domain: "www.google.com",
    title: "Red Dress — Acme Brand try-on",

    // Session entry attribution
    $session_entry_url: "http://localhost:3000/try/acme-brand/red-dress",
    $session_entry_host: "localhost:3000",
    $session_entry_pathname: "/try/acme-brand/red-dress",
    $session_entry_referrer: "https://www.google.com/",
    $session_entry_referring_domain: "www.google.com",
    $session_entry_utm_source: "newsletter",

    // Feature flags
    $active_feature_flags: [],
    $feature_flag_payloads: {},
    $feature_flag_request_id: "req_123",

    // SDK debug / remote capability reporting
    $initialization_time: 1_767_000_000,
    $configured_session_timeout_ms: 1_800_000,
    $autocapture_disabled_server_side: false,
    $web_vitals_enabled_server_side: true,
    $web_vitals_allowed_metrics: null,
    $exception_capture_enabled_server_side: true,
    $dead_clicks_enabled_server_side: true,
    $sdk_debug_extensions_init_method: "eager",
    $sdk_debug_extensions_init_time_ms: 12,
    $config_defaults: "2025-05-24",
    $sdk_debug_retry_queue_size: 0,
    $lib_rate_limit_remaining_tokens: 99,

    // Per-tab / per-pageview correlation
    $window_id: "0192f0c0-4444-7000-8000-000000000000",
    $pageview_id: "0192f0c0-5555-7000-8000-000000000000",
  };
}

describe("Phase 8C.2 outbound event firewall", () => {
  it("allows $pageview and every approved product event", () => {
    assert.equal(isAllowedOutboundPostHogEvent("$pageview"), true);

    for (const event of ANALYTICS_EVENTS) {
      assert.equal(isAllowedOutboundPostHogEvent(event), true, event);
      assert.notEqual(applyPostHogEventFirewall(captureResult(event)), null, event);
    }

    assert.equal(POSTHOG_ALLOWED_OUTBOUND_EVENTS.length, ANALYTICS_EVENTS.length + 1);
  });

  it("drops every SDK-generated event", () => {
    const sdkEvents = [
      "$autocapture",
      "$dead_click",
      "$exception",
      "$snapshot",
      "$pageleave",
      "$identify",
      "$create_alias",
      "$feature_flag_called",
      "$rageclick",
      "$web_vitals",
      "$copy_autocapture",
      "$groupidentify",
      "survey shown",
      "$set",
    ];

    for (const event of sdkEvents) {
      assert.equal(isAllowedOutboundPostHogEvent(event), false, event);
      assert.equal(applyPostHogEventFirewall(captureResult(event)), null, event);
    }
  });

  it("drops arbitrary and future unexpected events", () => {
    for (const event of ["$future_sdk_event", "custom_event", "try_on_started_v2", ""]) {
      assert.equal(applyPostHogEventFirewall(captureResult(event)), null, event);
    }
  });

  it("passes through a null event", () => {
    assert.equal(applyPostHogEventFirewall(null), null);
  });

  it("clears person-property payloads on allowed events", () => {
    const event = captureResult("try_on_started", { surface: "try_on" });
    event.$set = { email: "shopper@example.com" };
    event.$set_once = { $initial_referrer: "https://www.google.com/" };
    event.$unset = ["email"];

    const sanitized = applyPostHogEventFirewall(event);

    assert.equal(sanitized?.$set, undefined);
    assert.equal(sanitized?.$set_once, undefined);
    assert.equal(sanitized?.$unset, undefined);
  });
});

describe("Phase 8C.2 SDK property sanitizer", () => {
  const sanitized = sanitizePostHogEventProperties(livePageviewPayload());

  it("retains approved application properties", () => {
    assert.equal(sanitized.route_group, "/");
    assert.equal(sanitized.consent_version, 1);
  });

  it("retains required anonymous ingestion identifiers", () => {
    assert.equal(sanitized.token, "phc_live_key");
    assert.equal(sanitized.distinct_id, "0192f0c0-1111-7000-8000-000000000000");
    assert.equal(sanitized.$device_id, "0192f0c0-2222-7000-8000-000000000000");
    assert.equal(sanitized.$insert_id, "abc123");
    assert.equal(sanitized.$time, 1_767_000_000);
    assert.equal(sanitized.$lib, "web");
    assert.equal(sanitized.$lib_version, "1.421.2");
    assert.equal(sanitized.$sdk_dist_channel, "npm");
  });

  it("retains the anonymous PostHog session id and person-processing guards", () => {
    assert.equal(sanitized.$session_id, "0192f0c0-3333-7000-8000-000000000000");
    assert.equal(sanitized.$is_identified, false);
    assert.equal(sanitized.$process_person_profile, false);
  });

  it("removes raw location, referrer, and page title", () => {
    for (const key of [
      "$current_url",
      "$host",
      "$pathname",
      "$referrer",
      "$referring_domain",
      "title",
    ]) {
      assert.equal(key in sanitized, false, key);
    }
  });

  it("removes session-entry attribution including campaign parameters", () => {
    for (const key of Object.keys(livePageviewPayload()).filter((key) =>
      key.startsWith("$session_entry_"),
    )) {
      assert.equal(key in sanitized, false, key);
    }
  });

  it("removes user agent, browser, OS, device, and timezone metadata", () => {
    for (const key of [
      "$raw_user_agent",
      "$os",
      "$os_version",
      "$browser",
      "$browser_version",
      "$browser_language",
      "$browser_language_prefix",
      "$device_type",
      "$device_model",
      "$timezone",
      "$timezone_offset",
    ]) {
      assert.equal(key in sanitized, false, key);
    }
  });

  it("removes screen and viewport dimensions", () => {
    for (const key of ["$screen_height", "$screen_width", "$viewport_height", "$viewport_width"]) {
      assert.equal(key in sanitized, false, key);
    }
  });

  it("removes feature flag metadata", () => {
    for (const key of [
      "$active_feature_flags",
      "$feature_flag_payloads",
      "$feature_flag_request_id",
    ]) {
      assert.equal(key in sanitized, false, key);
    }
  });

  it("removes SDK debug and server-side capability metadata", () => {
    for (const key of [
      "$initialization_time",
      "$configured_session_timeout_ms",
      "$autocapture_disabled_server_side",
      "$web_vitals_enabled_server_side",
      "$web_vitals_allowed_metrics",
      "$exception_capture_enabled_server_side",
      "$dead_clicks_enabled_server_side",
      "$sdk_debug_extensions_init_method",
      "$sdk_debug_extensions_init_time_ms",
      "$config_defaults",
      "$sdk_debug_retry_queue_size",
      "$lib_rate_limit_remaining_tokens",
    ]) {
      assert.equal(key in sanitized, false, key);
    }
  });

  it("removes per-tab and per-pageview correlation identifiers", () => {
    assert.equal("$window_id" in sanitized, false);
    assert.equal("$pageview_id" in sanitized, false);
  });

  it("keeps route_group as the only navigation dimension", () => {
    const remaining = Object.keys(sanitized).filter(
      (key) => !key.startsWith("$") && key !== "token" && key !== "distinct_id",
    );

    assert.deepEqual(remaining.sort(), ["consent_version", "route_group"]);
  });

  it("drops unknown and future SDK properties by default", () => {
    const result = sanitizePostHogEventProperties({
      route_group: "dashboard_leads",
      $future_sdk_property: "leak",
      $some_new_url: "https://example.com/secret?token=abc",
      arbitrary_property: "leak",
    });

    assert.deepEqual(result, { route_group: "dashboard_leads", $geoip_disable: true });
  });

  it("retains approved application properties on product events", () => {
    const result = sanitizePostHogEventProperties({
      surface: "try_on",
      outcome: "failed",
      error_category: "generation_failed",
      consent_version: 1,
      route_group: "try",
      $current_url: "http://localhost:3000/try/acme-brand/red-dress",
    });

    assert.deepEqual(result, {
      surface: "try_on",
      outcome: "failed",
      error_category: "generation_failed",
      consent_version: 1,
      route_group: "try",
      $geoip_disable: true,
    });
  });

  it("handles missing properties safely", () => {
    assert.deepEqual(sanitizePostHogEventProperties(undefined), { $geoip_disable: true });
  });
});

describe("Phase 8C.2 GeoIP processing control", () => {
  it("stamps $geoip_disable = true on every allowed event", () => {
    for (const event of POSTHOG_ALLOWED_OUTBOUND_EVENTS) {
      const sanitized = applyPostHogEventFirewall(captureResult(event));

      assert.equal(sanitized?.properties[POSTHOG_GEOIP_DISABLE_PROPERTY], true, event);
    }
  });

  it("stamps it on the runtime-verified events specifically", () => {
    for (const event of [
      "$pageview",
      "try_on_started",
      "try_on_completed",
      "try_on_failed",
      "lead_form_viewed",
      "lead_submitted",
      "dashboard_leads_viewed",
    ]) {
      const sanitized = applyPostHogEventFirewall(
        captureResult(event, { route_group: "/try", consent_version: 1 }),
      );

      assert.equal(sanitized?.properties.$geoip_disable, true, event);
      assert.equal(sanitized?.properties.route_group, "/try", event);
      assert.equal(sanitized?.properties.consent_version, 1, event);
    }
  });

  it("overrides an incoming $geoip_disable: false", () => {
    const sanitized = applyPostHogEventFirewall(
      captureResult("try_on_started", { surface: "try_on", $geoip_disable: false }),
    );

    assert.equal(sanitized?.properties.$geoip_disable, true);
  });

  it("cannot be disabled by application properties", () => {
    for (const attempt of [false, 0, "false", null, undefined]) {
      const result = sanitizePostHogEventProperties({
        route_group: "/try",
        $geoip_disable: attempt,
      });

      assert.equal(result.$geoip_disable, true, String(attempt));
    }
  });

  it("is not reachable through the application track() property allowlist", () => {
    assert.equal(
      APPROVED_ANALYTICS_PROPERTY_KEYS.includes(
        POSTHOG_GEOIP_DISABLE_PROPERTY as (typeof APPROVED_ANALYTICS_PROPERTY_KEYS)[number],
      ),
      false,
    );

    const rejected = sanitizeAnalyticsEventInput(
      {
        event: "try_on_started",
        surface: "try_on",
        route_group: "/try",
        $geoip_disable: false,
      } as unknown as Parameters<typeof sanitizeAnalyticsEventInput>[0],
      1,
    );

    assert.equal(rejected, null);
  });

  it("survives the closed-world sanitizer alongside retained ingestion fields", () => {
    const result = sanitizePostHogEventProperties({
      distinct_id: "0192f0c0-1111-7000-8000-000000000000",
      $device_id: "0192f0c0-2222-7000-8000-000000000000",
      route_group: "/try",
    });

    assert.equal(result.$geoip_disable, true);
    assert.equal(result.distinct_id, "0192f0c0-1111-7000-8000-000000000000");
    assert.equal(result.$device_id, "0192f0c0-2222-7000-8000-000000000000");
  });

  it("never sends location or raw IP properties from the browser", () => {
    const result = sanitizePostHogEventProperties({
      route_group: "/try",
      $ip: "203.0.113.10",
      $geoip_city_name: "Karachi",
      $geoip_country_name: "Pakistan",
      $geoip_country_code: "PK",
      $geoip_continent_name: "Asia",
      $geoip_continent_code: "AS",
      $geoip_latitude: 24.8607,
      $geoip_longitude: 67.0011,
      $geoip_postal_code: "74000",
      $geoip_time_zone: "Asia/Karachi",
      $geoip_subdivision_1_name: "Sindh",
      $geoip_subdivision_1_code: "SD",
    });

    for (const key of POSTHOG_GEOIP_ENRICHMENT_PROPERTIES) {
      assert.equal(key in result, false, key);
    }

    assert.deepEqual(result, { route_group: "/try", $geoip_disable: true });
  });

  it("does not spoof an IP address anywhere in the firewall", () => {
    const source = readFileSync(join(ROOT, "lib/analytics/posthog-firewall.ts"), "utf8");

    assert.equal(source.includes("0.0.0.0"), false);
    assert.equal(source.includes("127.0.0.1"), false);
    assert.equal(/["']\$ip["']\s*:/.test(source), false);
  });
});

describe("Phase 8C.2 hardened PostHog configuration", () => {
  const config = buildPostHogInitConfig();

  it("disables every unused capture surface", () => {
    assert.equal(config.autocapture, false);
    assert.equal(config.capture_pageview, false);
    assert.equal(config.capture_pageleave, false);
    assert.equal(config.capture_dead_clicks, false);
    assert.equal(config.capture_exceptions, false);
    assert.equal(config.capture_heatmaps, false);
    assert.equal(config.capture_performance, false);
    assert.equal(config.disable_session_recording, true);
    assert.equal(config.disable_surveys, true);
    assert.equal(config.disable_scroll_properties, true);
    assert.equal(config.disableDeviceModel, true);
  });

  it("disables feature flags and toolbar metrics", () => {
    assert.equal(config.advanced_disable_feature_flags, true);
    assert.equal(config.advanced_disable_feature_flags_on_first_load, true);
    assert.equal(config.advanced_disable_toolbar_metrics, true);
  });

  it("disables referrer and campaign collection", () => {
    assert.equal(config.save_referrer, false);
    assert.equal(config.save_campaign_params, false);
  });

  it("uses localStorage persistence with no PostHog identity cookie", () => {
    assert.equal(config.persistence, "localStorage");
    assert.equal(config.disable_persistence, false);
    assert.equal(String(config.persistence).includes("cookie"), false);
  });

  it("never processes person profiles", () => {
    assert.equal(config.person_profiles, "never");
  });

  it("registers the outbound event firewall as before_send", () => {
    assert.equal(config.before_send, applyPostHogEventFirewall);
  });

  it("keeps debug logging off", () => {
    assert.equal(config.debug, false);
  });
});

describe("Phase 8C.2 identity guards", () => {
  it("never calls identify, alias, or group anywhere in source", () => {
    const files = walkSourceFiles(ROOT).filter((file) => !file.includes("/tests/"));

    for (const file of files) {
      const content = readFileSync(file, "utf8");

      assert.equal(content.includes("posthog.identify("), false, file);
      assert.equal(content.includes("posthog.alias("), false, file);
      assert.equal(content.includes("posthog.group("), false, file);
      assert.equal(content.includes("setPersonProperties"), false, file);
    }
  });

  it("does not send Supabase, lead, or customer identifiers through the sanitizer", () => {
    const result = sanitizePostHogEventProperties({
      route_group: "dashboard_leads",
      user_id: "5f2c1d4e-0000-4000-8000-000000000000",
      lead_id: "6f2c1d4e-0000-4000-8000-000000000000",
      email: "merchant@example.com",
      phone: "+923001234567",
      brand_id: "7f2c1d4e-0000-4000-8000-000000000000",
      $user_id: "5f2c1d4e-0000-4000-8000-000000000000",
    });

    assert.deepEqual(result, { route_group: "dashboard_leads", $geoip_disable: true });
  });
});
