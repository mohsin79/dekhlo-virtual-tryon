import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ACTIVE_TRY_ON_STORAGE_PREFIX,
  activeTryOnStorageKey,
  clearActiveTryOnSessionId,
  readActiveTryOnSessionId,
  writeActiveTryOnSessionId,
} from "@/lib/try-on/sessions/active-session-storage";
import {
  buildTryOnSessionStatusUrl,
  evaluateSessionRestoreResponse,
  isValidTryOnSessionId,
} from "@/lib/try-on/sessions/session-restoration";
import { sessionMatchesProductScope } from "@/lib/try-on/sessions/session-product-scope";

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("active try-on session storage", () => {
  it("uses route-scoped keys with brand and product slugs", () => {
    assert.equal(activeTryOnStorageKey("acme", "dress"), `${ACTIVE_TRY_ON_STORAGE_PREFIX}acme:dress`);
  });

  it("stores only the session UUID without tokens or PII", () => {
    const storage = new Map<string, string>();

    globalThis.window = globalThis as Window & typeof globalThis;
    globalThis.sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
      key: () => null,
      length: storage.size,
    } as Storage;

    writeActiveTryOnSessionId("acme", "dress", SESSION_ID);

    const key = activeTryOnStorageKey("acme", "dress");
    const stored = storage.get(key);

    assert.equal(stored, SESSION_ID);
    assert.equal(stored?.includes("@"), false);
    assert.equal(stored?.includes("http"), false);
    assert.equal(stored?.includes("token"), false);
    assert.equal(isValidTryOnSessionId(stored), true);

    assert.equal(readActiveTryOnSessionId("acme", "dress"), SESSION_ID);

    clearActiveTryOnSessionId("acme", "dress");
    assert.equal(readActiveTryOnSessionId("acme", "dress"), null);
  });

  it("isolates storage per product route", () => {
    const storage = new Map<string, string>();

    globalThis.window = globalThis as Window & typeof globalThis;
    globalThis.sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
      key: () => null,
      length: storage.size,
    } as Storage;

    writeActiveTryOnSessionId("acme", "dress-a", SESSION_ID);
    assert.equal(readActiveTryOnSessionId("acme", "dress-b"), null);
  });
});

describe("session restore response evaluation", () => {
  it("restores completed sessions with a result URL", () => {
    const outcome = evaluateSessionRestoreResponse({
      httpStatus: 200,
      status: "completed",
      resultUrl: "https://example.test/result.png",
    });

    assert.deepEqual(outcome, {
      kind: "completed",
      resultUrl: "https://example.test/result.png",
      status: "completed",
    });
  });

  it("resumes polling for queued and processing sessions", () => {
    assert.deepEqual(
      evaluateSessionRestoreResponse({ httpStatus: 200, status: "queued" }),
      { kind: "resume_polling", status: "queued" },
    );
    assert.deepEqual(
      evaluateSessionRestoreResponse({ httpStatus: 200, status: "processing" }),
      { kind: "resume_polling", status: "processing" },
    );
  });

  it("clears storage for expired, invalid, deleted, or unauthorized sessions", () => {
    for (const httpStatus of [401, 403, 404, 410]) {
      assert.deepEqual(evaluateSessionRestoreResponse({ httpStatus, status: "completed" }), {
        kind: "clear",
      });
    }

    for (const status of ["failed", "cancelled", "pending_upload"] as const) {
      assert.deepEqual(
        evaluateSessionRestoreResponse({ httpStatus: 200, status }),
        { kind: "clear" },
      );
    }
  });

  it("clears when completed sessions have no result URL", () => {
    assert.deepEqual(
      evaluateSessionRestoreResponse({ httpStatus: 200, status: "completed", resultUrl: null }),
      { kind: "clear" },
    );
  });

  it("validates UUID session IDs before restoration", () => {
    assert.equal(isValidTryOnSessionId(SESSION_ID), true);
    assert.equal(isValidTryOnSessionId("not-a-uuid"), false);
    assert.equal(isValidTryOnSessionId(null), false);
  });

  it("builds scoped session status URLs for restoration polling", () => {
    const url = buildTryOnSessionStatusUrl(SESSION_ID, "acme", "dress");
    assert.match(url, new RegExp(`^/api/try-on/sessions/${SESSION_ID}\\?`));
    assert.match(url, /brandSlug=acme/);
    assert.match(url, /productSlug=dress/);
  });
});

describe("session product scope", () => {
  it("matches sessions to the current public product", () => {
    assert.equal(
      sessionMatchesProductScope(
        { brand_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", product_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
        { brandId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", productId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      ),
      true,
    );
    assert.equal(
      sessionMatchesProductScope(
        { brand_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", product_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
        { brandId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", productId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      ),
      false,
    );
  });
});

describe("ProductTryOn refresh restoration integration", () => {
  it("reads saved session ID on mount and restores completed results", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /readActiveTryOnSessionId\(brandSlug, productSlug\)/);
    assert.match(source, /evaluateSessionRestoreResponse/);
    assert.match(source, /setPhase\("done"\)/);
    assert.match(source, /setCompletedSessionId/);
    assert.match(source, /setCurrentResultUrl/);
  });

  it("persists session ID when a merchant session is created", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /writeActiveTryOnSessionId\(brandSlug, productSlug, createPayload\.sessionId\)/);
  });

  it("resumes polling without enqueueing another generation", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /pollTryOnSessionUntilTerminal/);
    assert.equal(source.includes("/validate-upload"), true);
    assert.equal(source.match(/\/validate-upload/g)?.length, 1);
    assert.equal(source.match(/fetch\("\/api\/try-on\/sessions"/g)?.length, 1);
  });

  it("clears stored session IDs for invalid sessions and new try-ons", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /clearActiveTryOnSessionId\(brandSlug, productSlug\)/);
    assert.match(source, /handleChooseAnotherPhoto/);
  });

  it("does not auto-submit leads or call side-effect APIs during restoration", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /LeadCaptureForm/);
    assert.equal(source.includes("/api/inngest"), false);
    assert.equal(source.includes("openai"), false);
    assert.equal(source.includes("queue_try_on_session"), false);
    assert.equal(/\/sessions\/\$\{[^}]+\}\/lead/.test(source), false);
  });

  it("uses abort cleanup to avoid duplicate restoration requests", () => {
    const source = readFileSync("components/ProductTryOn.tsx", "utf8");
    assert.match(source, /AbortController/);
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /signal: controller\.signal/);
  });

  it("loads lead submitted state via GET without auto POST", () => {
    const source = readFileSync("components/leads/lead-capture-form.tsx", "utf8");
    assert.match(source, /method: "GET"/);
    assert.match(source, /payload\.submitted === true/);
    assert.match(source, /setStatusState\("submitted"\)/);
    assert.match(source, /setStatusState\("ready"\)/);
    assert.equal(source.match(/method: "POST"/g)?.length, 1);
  });
});

describe("session status route product scope", () => {
  it("validates brand and product slugs for scoped restoration requests", () => {
    const source = readFileSync("app/api/try-on/sessions/[sessionId]/route.ts", "utf8");
    assert.match(source, /sessionMatchesProductScope/);
    assert.match(source, /getPublicProductBySlugs/);
    assert.match(source, /brandSlug/);
    assert.match(source, /productSlug/);
  });
});

describe("client session polling boundaries", () => {
  it("polls scoped session status URLs only", () => {
    const source = readFileSync("lib/try-on/sessions/client-session-polling.ts", "utf8");
    assert.match(source, /buildTryOnSessionStatusUrl/);
    assert.equal(source.includes("/generate"), false);
    assert.equal(source.includes("validate-upload"), false);
  });
});
