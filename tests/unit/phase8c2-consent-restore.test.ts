import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ANALYTICS_CONSENT_COOKIE,
  describeAnalyticsPreference,
  isAnalyticsConsentResolved,
  parseAnalyticsConsentCookie,
  resolveConsentLifecycleAction,
  serializeAnalyticsConsentRecord,
  shouldShowMainConsentBanner,
  type AnalyticsConsentStatus,
} from "@/lib/analytics/consent";
import { readAnalyticsConsentFromDocument } from "@/lib/analytics/consent-cookie";
import {
  __resetAnalyticsConsentStoreForTests,
  clearAnalyticsConsentDecision,
  getAnalyticsConsentServerSnapshot,
  getAnalyticsConsentSnapshot,
  recordAnalyticsConsentDecision,
  subscribeToAnalyticsConsent,
} from "@/lib/analytics/consent-store";

const ROOT = process.cwd();

/**
 * Minimal document.cookie stand-in so the real read/write helpers can be exercised, including
 * across simulated page refreshes.
 */
function installCookieJar(): { setRaw: (value: string) => void; uninstall: () => void } {
  const jar = new Map<string, string>();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      get cookie(): string {
        return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
      },
      set cookie(header: string) {
        const [pair, ...attributes] = header.split(";");
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        const maxAge = attributes
          .map((attribute) => attribute.trim().toLowerCase())
          .find((attribute) => attribute.startsWith("max-age="));

        if (maxAge?.endsWith("=0")) {
          jar.delete(name);
          return;
        }

        jar.set(name, value);
      },
    },
  });

  return {
    setRaw: (value: string) => jar.set(ANALYTICS_CONSENT_COOKIE, value),
    uninstall: () => {
      Reflect.deleteProperty(globalThis as Record<string, unknown>, "document");
    },
  };
}

type MountResult = {
  status: AnalyticsConsentStatus;
  bannerDuringHydration: boolean;
  bannerAfterResolve: boolean;
  initializeCount: number;
  shutdownCount: number;
};

/**
 * Mirrors PostHogProvider: the hydration render uses the "resolving" server snapshot, the client
 * snapshot is adopted right after hydration, then a lifecycle effect initializes or disables
 * PostHog. Clearing the store cache models a full page refresh.
 */
function simulateProviderMount(isConfigured = true): MountResult {
  __resetAnalyticsConsentStoreForTests();

  const hydrationStatus: AnalyticsConsentStatus = getAnalyticsConsentServerSnapshot();
  const bannerDuringHydration = shouldShowMainConsentBanner(hydrationStatus);

  let initializeCount = 0;
  let shutdownCount = 0;

  const status = getAnalyticsConsentSnapshot();

  const action = resolveConsentLifecycleAction(status, isConfigured);

  if (action === "initialize") {
    initializeCount += 1;
  } else if (action === "shutdown") {
    shutdownCount += 1;
  }

  return {
    status,
    bannerDuringHydration,
    bannerAfterResolve: shouldShowMainConsentBanner(status),
    initializeCount,
    shutdownCount,
  };
}

describe("Phase 8C.2 consent banner gating", () => {
  it("never shows the main banner while consent is unresolved", () => {
    assert.equal(shouldShowMainConsentBanner("resolving"), false);
    assert.equal(isAnalyticsConsentResolved("resolving"), false);
  });

  it("shows the main banner only for undecided", () => {
    assert.equal(shouldShowMainConsentBanner("undecided"), true);
    assert.equal(shouldShowMainConsentBanner("accepted"), false);
    assert.equal(shouldShowMainConsentBanner("declined"), false);
  });

  it("treats accepted and declined as resolved", () => {
    assert.equal(isAnalyticsConsentResolved("accepted"), true);
    assert.equal(isAnalyticsConsentResolved("declined"), true);
    assert.equal(isAnalyticsConsentResolved("undecided"), true);
  });
});

describe("Phase 8C.2 consent lifecycle actions", () => {
  it("does nothing until consent is resolved", () => {
    assert.equal(resolveConsentLifecycleAction("resolving", true), "none");
  });

  it("initializes only for accepted consent with configured env", () => {
    assert.equal(resolveConsentLifecycleAction("accepted", true), "initialize");
    assert.equal(resolveConsentLifecycleAction("accepted", false), "shutdown");
  });

  it("keeps PostHog disabled for declined and undecided", () => {
    assert.equal(resolveConsentLifecycleAction("declined", true), "shutdown");
    assert.equal(resolveConsentLifecycleAction("undecided", true), "shutdown");
  });
});

describe("Phase 8C.2 cookie parsing robustness", () => {
  it("parses browser-encoded cookie values", () => {
    const encoded = encodeURIComponent(serializeAnalyticsConsentRecord("declined"));
    assert.equal(parseAnalyticsConsentCookie(encoded), "declined");
  });

  it("parses unencoded and quoted cookie values", () => {
    const raw = serializeAnalyticsConsentRecord("accepted");
    assert.equal(parseAnalyticsConsentCookie(raw), "accepted");
    assert.equal(parseAnalyticsConsentCookie(`"${raw}"`), "accepted");
  });

  it("falls back to undecided for malformed, empty, and version-mismatched values", () => {
    assert.equal(parseAnalyticsConsentCookie(""), "undecided");
    assert.equal(parseAnalyticsConsentCookie("%7Bbroken"), "undecided");
    assert.equal(parseAnalyticsConsentCookie("declined"), "undecided");
    assert.equal(
      parseAnalyticsConsentCookie(
        encodeURIComponent(serializeAnalyticsConsentRecord("declined").replace('"v":1', '"v":2')),
      ),
      "undecided",
    );
  });
});

describe("Phase 8C.2 consent restoration across refresh", () => {
  let jar: ReturnType<typeof installCookieJar>;

  beforeEach(() => {
    jar = installCookieJar();
    __resetAnalyticsConsentStoreForTests();
  });

  afterEach(() => {
    __resetAnalyticsConsentStoreForTests();
    jar.uninstall();
  });

  it("shows the banner when no cookie exists", () => {
    const mount = simulateProviderMount();

    assert.equal(mount.status, "undecided");
    assert.equal(mount.bannerAfterResolve, true);
    assert.equal(mount.initializeCount, 0);
  });

  it("shows the banner for a malformed cookie", () => {
    jar.setRaw("not-json");

    const mount = simulateProviderMount();

    assert.equal(mount.status, "undecided");
    assert.equal(mount.bannerAfterResolve, true);
  });

  it("shows the banner for an unsupported cookie version", () => {
    jar.setRaw(
      encodeURIComponent(serializeAnalyticsConsentRecord("accepted").replace('"v":1', '"v":9')),
    );

    const mount = simulateProviderMount();

    assert.equal(mount.status, "undecided");
    assert.equal(mount.bannerAfterResolve, true);
    assert.equal(mount.initializeCount, 0);
  });

  it("closes the banner immediately after Decline and persists the choice", () => {
    assert.equal(simulateProviderMount().bannerAfterResolve, true);

    let notifications = 0;
    const unsubscribe = subscribeToAnalyticsConsent(() => {
      notifications += 1;
    });

    recordAnalyticsConsentDecision("declined");

    assert.equal(notifications, 1);
    assert.equal(getAnalyticsConsentSnapshot(), "declined");
    assert.equal(shouldShowMainConsentBanner(getAnalyticsConsentSnapshot()), false);
    assert.equal(readAnalyticsConsentFromDocument(), "declined");

    unsubscribe();
  });

  it("keeps the banner hidden and PostHog uninitialized after refresh with declined cookie", () => {
    recordAnalyticsConsentDecision("declined");

    const firstRefresh = simulateProviderMount();
    const secondRefresh = simulateProviderMount();

    for (const mount of [firstRefresh, secondRefresh]) {
      assert.equal(mount.status, "declined");
      assert.equal(mount.bannerDuringHydration, false);
      assert.equal(mount.bannerAfterResolve, false);
      assert.equal(mount.initializeCount, 0);
      assert.equal(mount.shutdownCount, 1);
    }
  });

  it("keeps the banner hidden and restores PostHog after refresh with accepted cookie", () => {
    recordAnalyticsConsentDecision("accepted");

    const mount = simulateProviderMount();

    assert.equal(mount.status, "accepted");
    assert.equal(mount.bannerDuringHydration, false);
    assert.equal(mount.bannerAfterResolve, false);
    assert.equal(mount.initializeCount, 1);
  });

  it("does not initialize PostHog on refresh when env config is missing", () => {
    recordAnalyticsConsentDecision("accepted");

    const mount = simulateProviderMount(false);

    assert.equal(mount.bannerAfterResolve, false);
    assert.equal(mount.initializeCount, 0);
    assert.equal(mount.shutdownCount, 1);
  });

  it("never flashes the banner during hydration for a valid stored decision", () => {
    for (const decision of ["accepted", "declined"] as const) {
      recordAnalyticsConsentDecision(decision);
      const mount = simulateProviderMount();

      assert.equal(mount.bannerDuringHydration, false, decision);
      assert.equal(mount.bannerAfterResolve, false, decision);
    }
  });

  it("lets Analytics preferences change a declined choice without reopening the main banner", () => {
    recordAnalyticsConsentDecision("declined");
    assert.equal(simulateProviderMount().bannerAfterResolve, false);

    assert.equal(describeAnalyticsPreference("declined"), "Analytics declined");

    recordAnalyticsConsentDecision("accepted");
    const afterChange = simulateProviderMount();

    assert.equal(afterChange.status, "accepted");
    assert.equal(afterChange.bannerAfterResolve, false);
    assert.equal(afterChange.initializeCount, 1);
    assert.equal(describeAnalyticsPreference("accepted"), "Analytics accepted");
  });

  it("re-prompts only after an explicit consent reset", () => {
    recordAnalyticsConsentDecision("declined");
    assert.equal(readAnalyticsConsentFromDocument(), "declined");

    clearAnalyticsConsentDecision();

    const mount = simulateProviderMount();
    assert.equal(mount.status, "undecided");
    assert.equal(mount.bannerAfterResolve, true);
    assert.equal(describeAnalyticsPreference("undecided"), "No analytics preference saved");
  });
});

describe("Phase 8C.2 consent source guards", () => {
  it("gates the main banner through shouldShowMainConsentBanner only", () => {
    const banner = readFileSync(
      join(ROOT, "components/analytics/analytics-consent-banner.tsx"),
      "utf8",
    );

    assert.match(banner, /shouldShowMainConsentBanner\(status\)/);
    assert.equal(banner.includes('consent !== "undecided"'), false);
  });

  it("does not seed consent state from a server render", () => {
    const provider = readFileSync(
      join(ROOT, "components/analytics/posthog-provider.tsx"),
      "utf8",
    );

    assert.match(provider, /useSyncExternalStore\(/);
    assert.match(provider, /getAnalyticsConsentServerSnapshot/);
    assert.equal(provider.includes('typeof document === "undefined" ? "undecided"'), false);
    assert.equal(provider.includes('useState<AnalyticsConsentState>'), false);
  });

  it("returns an unresolved server snapshot so prerendered HTML never contains the banner", () => {
    assert.equal(getAnalyticsConsentServerSnapshot(), "resolving");
    assert.equal(shouldShowMainConsentBanner(getAnalyticsConsentServerSnapshot()), false);
  });

  it("does not reset consent to undecided from the preferences control", () => {
    const control = readFileSync(
      join(ROOT, "components/analytics/analytics-preferences-control.tsx"),
      "utf8",
    );

    assert.equal(control.includes("resetConsent"), false);
    assert.match(control, /declineConsent/);
    assert.match(control, /acceptConsent/);
  });
});
