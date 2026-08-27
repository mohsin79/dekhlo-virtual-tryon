import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ANALYTICS_CONSENT_VERSION,
  buildAnalyticsConsentClearCookieHeader,
  buildAnalyticsConsentCookieHeader,
  consentRecordContainsPii,
  parseAnalyticsConsentCookie,
  serializeAnalyticsConsentRecord,
} from "@/lib/analytics/consent";
import {
  isAnalyticsEventName,
  isForbiddenAnalyticsPropertyKey,
  mapTryOnClientFailureCategory,
  sanitizeAnalyticsEventInput,
} from "@/lib/analytics/events";
import { isPostHogConfigured } from "@/lib/analytics/env";
import {
  POSTHOG_PRIVACY_INIT_FLAGS,
  buildPostHogInitConfig,
} from "@/lib/analytics/posthog-config";
import {
  __resetPostHogClientStateForTests,
  initializePostHogClient,
  isPostHogClientInitialized,
  shutdownPostHogClient,
} from "@/lib/analytics/posthog-client";
import {
  consumePendingAnalyticsEvent,
  markPendingAnalyticsEvent,
  __clearPendingAnalyticsEventsForTests,
} from "@/lib/analytics/pending-events";
import { pathnameToRouteGroup } from "@/lib/analytics/route-groups";
import {
  __getAnalyticsCaptureHandlerForTests,
  __isAnalyticsConsentAcceptedForTests,
  setAnalyticsCaptureHandler,
  setAnalyticsConsentAccepted,
  trackAnalyticsEvent,
} from "@/lib/analytics/track";

const ROOT = join(process.cwd());

function walkSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") {
      continue;
    }

    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      walkSourceFiles(fullPath, files);
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Phase 8C.2 consent", () => {
  it("treats missing cookie as undecided", () => {
    assert.equal(parseAnalyticsConsentCookie(null), "undecided");
    assert.equal(parseAnalyticsConsentCookie(undefined), "undecided");
  });

  it("treats malformed cookie as undecided", () => {
    assert.equal(parseAnalyticsConsentCookie("{not-json"), "undecided");
    assert.equal(parseAnalyticsConsentCookie("accepted"), "undecided");
  });

  it("treats unsupported version as undecided", () => {
    assert.equal(
      parseAnalyticsConsentCookie(
        serializeAnalyticsConsentRecord("accepted").replace('"v":1', '"v":2'),
      ),
      "undecided",
    );
  });

  it("parses accepted and declined cookies", () => {
    assert.equal(parseAnalyticsConsentCookie(serializeAnalyticsConsentRecord("accepted")), "accepted");
    assert.equal(parseAnalyticsConsentCookie(serializeAnalyticsConsentRecord("declined")), "declined");
  });

  it("stores no PII in consent cookie payload", () => {
    const record = JSON.parse(serializeAnalyticsConsentRecord("accepted")) as {
      v: number;
      state: "accepted";
      at: string;
    };

    assert.equal(consentRecordContainsPii(record), false);
    assert.equal(record.v, ANALYTICS_CONSENT_VERSION);
  });

  it("builds cookie attributes with Path=/ and SameSite=Lax", () => {
    const devHeader = buildAnalyticsConsentCookieHeader("accepted", false);
    const prodHeader = buildAnalyticsConsentCookieHeader("accepted", true);

    assert.match(devHeader, /Path=\//);
    assert.match(devHeader, /SameSite=Lax/);
    assert.match(devHeader, /Max-Age=31536000/);
    assert.equal(devHeader.includes("Secure"), false);
    assert.match(prodHeader, /Secure/);

    const clearHeader = buildAnalyticsConsentClearCookieHeader(true);
    assert.match(clearHeader, /Max-Age=0/);
    assert.match(clearHeader, /SameSite=Lax/);
  });
});

describe("Phase 8C.2 PostHog configuration", () => {
  it("disables autocapture, replay, dead clicks, and surveys", () => {
    const config = buildPostHogInitConfig();

    assert.equal(config.autocapture, false);
    assert.equal(config.capture_pageview, false);
    assert.equal(config.disable_session_recording, true);
    assert.equal(config.capture_dead_clicks, false);
    assert.equal(config.disable_surveys, true);
    assert.deepEqual(POSTHOG_PRIVACY_INIT_FLAGS.autocapture, false);
  });

  it("no-ops when PostHog env config is missing", () => {
    const previousKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const previousHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    __resetPostHogClientStateForTests();

    try {
      assert.equal(isPostHogConfigured(), false);
      assert.equal(initializePostHogClient(), false);
      assert.equal(isPostHogClientInitialized(), false);
    } finally {
      if (previousKey === undefined) {
        delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
      } else {
        process.env.NEXT_PUBLIC_POSTHOG_KEY = previousKey;
      }

      if (previousHost === undefined) {
        delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
      } else {
        process.env.NEXT_PUBLIC_POSTHOG_HOST = previousHost;
      }

      __resetPostHogClientStateForTests();
    }
  });
});

describe("Phase 8C.2 analytics wrapper", () => {
  it("no-ops when consent is not accepted", () => {
    setAnalyticsConsentAccepted(false);
    setAnalyticsCaptureHandler(() => {});

    assert.equal(
      trackAnalyticsEvent({
        event: "signup_started",
        surface: "auth",
        route_group: "/auth",
      }),
      false,
    );
  });

  it("captures allowlisted events with approved properties only", () => {
    const captured: Array<{ event: string; properties: Record<string, string | number> }> = [];

    setAnalyticsConsentAccepted(true);
    setAnalyticsCaptureHandler((event, properties) => {
      captured.push({ event, properties });
    });

    assert.equal(
      trackAnalyticsEvent({
        event: "try_on_failed",
        surface: "try_on",
        route_group: "/try",
        outcome: "failed",
        error_category: "generation_failed",
      }),
      true,
    );

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.event, "try_on_failed");
    assert.equal(captured[0]?.properties.error_category, "generation_failed");
    assert.equal(captured[0]?.properties.route_group, "/try");
  });

  it("rejects forbidden property names and unsafe values", () => {
    const input = {
      event: "lead_submitted" as const,
      surface: "lead" as const,
      route_group: "/try" as const,
      outcome: "submitted" as const,
      email: "shopper@example.com",
    };

    assert.equal(sanitizeAnalyticsEventInput(input as never, 1), null);
    assert.equal(isForbiddenAnalyticsPropertyKey("email"), true);
    assert.equal(isForbiddenAnalyticsPropertyKey("session_id"), true);
    assert.equal(isForbiddenAnalyticsPropertyKey("surface"), false);
  });

  it("rejects unknown events", () => {
    assert.equal(isAnalyticsEventName("platform_credit_grant_completed"), false);
  });

  it("stops capture after consent is withdrawn", () => {
    const captured: string[] = [];

    setAnalyticsConsentAccepted(true);
    setAnalyticsCaptureHandler((event) => {
      captured.push(event);
    });

    trackAnalyticsEvent({
      event: "signup_started",
      surface: "auth",
      route_group: "/auth",
    });

    setAnalyticsConsentAccepted(false);
    setAnalyticsCaptureHandler(null);

    assert.equal(captured.length, 1);
    assert.equal(
      trackAnalyticsEvent({
        event: "signup_started",
        surface: "auth",
        route_group: "/auth",
      }),
      false,
    );
    assert.equal(__isAnalyticsConsentAcceptedForTests(), false);
    assert.equal(__getAnalyticsCaptureHandlerForTests(), null);
  });
});

describe("Phase 8C.2 route groups and public flows", () => {
  it("maps dynamic try-on URLs to /try without slugs", () => {
    assert.equal(pathnameToRouteGroup("/try/acme/kurta"), "/try");
    assert.equal(pathnameToRouteGroup("/dashboard/leads"), "/dashboard/leads");
  });

  it("maps try-on failure categories without raw provider text", () => {
    assert.equal(
      mapTryOnClientFailureCategory({ phase: "polling", message: "provider timeout detail" }),
      "generation_failed",
    );
    assert.equal(
      mapTryOnClientFailureCategory({ message: "This brand does not have enough credits" }),
      "credits_unavailable",
    );
  });

  it("does not include session identifiers in sanitized try-on events", () => {
    const properties = sanitizeAnalyticsEventInput(
      {
        event: "try_on_started",
        surface: "try_on",
        route_group: "/try",
        outcome: "started",
      },
      1,
    );

    assert.deepEqual(properties, {
      consent_version: 1,
      surface: "try_on",
      route_group: "/try",
      outcome: "started",
    });
    assert.equal(JSON.stringify(properties).includes("session"), false);
  });
});

describe("Phase 8C.2 no-capture surfaces", () => {
  it("protects uploader, try-on person area, and lead form", () => {
    const uploader = readFileSync(join(ROOT, "components/Uploader.tsx"), "utf8");
    const tryOn = readFileSync(join(ROOT, "components/ProductTryOn.tsx"), "utf8");
    const leadForm = readFileSync(join(ROOT, "components/leads/lead-capture-form.tsx"), "utf8");

    assert.match(uploader, /data-ph-no-capture/);
    assert.match(uploader, /ph-no-capture/);
    assert.match(tryOn, /data-ph-no-capture/);
    assert.match(leadForm, /data-ph-no-capture/);
    assert.match(leadForm, /ph-no-capture/);
  });
});

describe("Phase 8C.2 source privacy guards", () => {
  const allowedPosthogCaptureFiles = ["lib/analytics/posthog-client.ts"];

  it("does not call posthog.capture, identify, or alias outside the analytics client", () => {
    const files = walkSourceFiles(ROOT).filter(
      (file) => !file.includes("/tests/") && !file.includes("node_modules"),
    );

    for (const file of files) {
      if (allowedPosthogCaptureFiles.some((allowed) => file.endsWith(allowed))) {
        continue;
      }

      const content = readFileSync(file, "utf8");

      assert.equal(content.includes("posthog.capture("), false, file);
      assert.equal(content.includes("posthog.identify("), false, file);
      assert.equal(content.includes("posthog.alias("), false, file);
    }
  });

  it("does not enable autocapture or session replay in app source", () => {
    const files = walkSourceFiles(ROOT).filter(
      (file) => !file.includes("/tests/") && !file.includes("node_modules"),
    );

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      assert.equal(content.includes("autocapture: true"), false, file);
      assert.equal(content.includes("disable_session_recording: false"), false, file);
    }
  });
});

describe("Phase 8C.2 pending server-action events", () => {
  it("consumes pending analytics markers once", () => {
    __clearPendingAnalyticsEventsForTests();
    markPendingAnalyticsEvent("brand_created");
    assert.equal(consumePendingAnalyticsEvent("brand_created"), true);
    assert.equal(consumePendingAnalyticsEvent("brand_created"), false);
  });
});

describe("Phase 8C.2 provider lifecycle helpers", () => {
  it("tracks initialized state and supports shutdown reset", () => {
    __resetPostHogClientStateForTests();
    shutdownPostHogClient();
    assert.equal(isPostHogClientInitialized(), false);
  });
});
