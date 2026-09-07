import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { exceedsContentLengthLimit } from "@/lib/api/body-limits";
import {
  assertInngestEventSendingConfigured,
  resolveInngestDevMode,
} from "@/lib/inngest/env";
import { DEMO_MAX_MULTIPART_BODY_BYTES } from "@/lib/try-on/demo-constants";
import {
  PERSON_PHOTO_MAX_BYTES,
  TRY_ON_MAX_JSON_BODY_BYTES,
} from "@/lib/try-on/sessions/constants";
import {
  isValidTryOnSessionId,
  TRY_ON_SESSION_NOT_FOUND_MESSAGE,
} from "@/lib/try-on/sessions/session-id";

const SESSION_CREATE_ROUTE = "app/api/try-on/sessions/route.ts";
const DEMO_HANDLER = "lib/try-on/demo-handler.ts";
const SESSION_ID_ROUTES = [
  "app/api/try-on/sessions/[sessionId]/route.ts",
  "app/api/try-on/sessions/[sessionId]/generate/route.ts",
  "app/api/try-on/sessions/[sessionId]/validate-upload/route.ts",
];

describe("Content-Length body guard", () => {
  it("rejects a declared body larger than the limit", () => {
    assert.equal(exceedsContentLengthLimit("5000", 4096), true);
  });

  it("allows a declared body exactly at the limit", () => {
    assert.equal(exceedsContentLengthLimit("4096", 4096), false);
    assert.equal(exceedsContentLengthLimit("4095", 4096), false);
  });

  it("falls through to normal parsing when Content-Length is absent", () => {
    assert.equal(exceedsContentLengthLimit(null, 4096), false);
    assert.equal(exceedsContentLengthLimit("", 4096), false);
  });

  it("falls through to normal parsing when Content-Length is unparseable", () => {
    assert.equal(exceedsContentLengthLimit("not-a-number", 4096), false);
    assert.equal(exceedsContentLengthLimit("NaN", 4096), false);
  });

  it("documents that Content-Length is an early guard, not a streaming bound", () => {
    const source = readFileSync("lib/api/body-limits.ts", "utf8");
    assert.match(source, /advisory only/i);
    assert.match(source, /chunked transfer encoding/i);
    assert.match(source, /NOT a\s*\n?\s*\*?\s*complete streaming bound/i);
  });
});

describe("try-on session-create JSON body bound", () => {
  it("bounds the session-create JSON contract at 4096 bytes", () => {
    assert.equal(TRY_ON_MAX_JSON_BODY_BYTES, 4096);
  });

  it("leaves a realistic session-create payload well under the bound", () => {
    const body = JSON.stringify({
      brandSlug: "a".repeat(120),
      productSlug: "b".repeat(120),
      clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
      consentToStore: true,
    });

    assert.equal(
      exceedsContentLengthLimit(String(Buffer.byteLength(body)), TRY_ON_MAX_JSON_BODY_BYTES),
      false,
    );
  });

  it("rejects an inflated session-create payload", () => {
    const body = JSON.stringify({
      brandSlug: "a".repeat(50_000),
      productSlug: "b",
      clientRequestId: "550e8400-e29b-41d4-a716-446655440000",
      consentToStore: true,
    });

    assert.equal(
      exceedsContentLengthLimit(String(Buffer.byteLength(body)), TRY_ON_MAX_JSON_BODY_BYTES),
      true,
    );
  });

  it("applies the size guard before JSON parsing", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");
    const guardIndex = source.lastIndexOf("exceedsContentLengthLimit(");
    const parseIndex = source.indexOf("await request.json()");

    assert.ok(guardIndex > -1, "session-create must call the body-size guard");
    assert.ok(parseIndex > -1, "session-create must still parse JSON");
    assert.ok(guardIndex < parseIndex, "the size guard must run before JSON parsing");
  });

  it("keeps the existing generic responses for oversized and malformed bodies", () => {
    const source = readFileSync(SESSION_CREATE_ROUTE, "utf8");
    assert.match(source, /genericErrorResponse\("Request body is too large\.", 400\)/);
    assert.match(source, /genericErrorResponse\("Invalid JSON body\.", 400\)/);
  });

  it("keeps the JSON bound distinct from the shopper image bound", () => {
    assert.notEqual(TRY_ON_MAX_JSON_BODY_BYTES, PERSON_PHOTO_MAX_BYTES);
    assert.ok(TRY_ON_MAX_JSON_BODY_BYTES < PERSON_PHOTO_MAX_BYTES);
  });
});

describe("demo multipart body bound", () => {
  it("bounds the total demo multipart body at 20 MB", () => {
    assert.equal(DEMO_MAX_MULTIPART_BODY_BYTES, 20 * 1024 * 1024);
  });

  it("admits two near-limit images plus multipart framing overhead", () => {
    const twoMaximumImagesWithOverhead = PERSON_PHOTO_MAX_BYTES * 2 + 4096;

    assert.ok(twoMaximumImagesWithOverhead < DEMO_MAX_MULTIPART_BODY_BYTES);
    assert.equal(
      exceedsContentLengthLimit(
        String(twoMaximumImagesWithOverhead),
        DEMO_MAX_MULTIPART_BODY_BYTES,
      ),
      false,
    );
  });

  it("rejects an oversized multipart body", () => {
    assert.equal(
      exceedsContentLengthLimit(
        String(DEMO_MAX_MULTIPART_BODY_BYTES + 1),
        DEMO_MAX_MULTIPART_BODY_BYTES,
      ),
      true,
    );
  });

  it("preserves current behavior when Content-Length is absent", () => {
    assert.equal(exceedsContentLengthLimit(null, DEMO_MAX_MULTIPART_BODY_BYTES), false);
  });

  it("applies the total guard before formData() and answers 413", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");
    const guardIndex = source.lastIndexOf("exceedsContentLengthLimit(");
    const formDataIndex = source.indexOf("await request.formData()");

    assert.ok(guardIndex > -1, "demo handler must call the body-size guard");
    assert.ok(formDataIndex > -1, "demo handler must still parse form data");
    assert.ok(guardIndex < formDataIndex, "the total guard must run before formData()");
    assert.match(source, /genericErrorResponse\("Request body is too large\.", 413\)/);
  });

  it("leaves the per-file 8 MB image validation unchanged", () => {
    const source = readFileSync(DEMO_HANDLER, "utf8");
    assert.match(source, /const MAX_BYTES = 8 \* 1024 \* 1024;/);
    assert.match(source, /Each image must be under 8MB\./);
  });

  it("documents the demo bound as an early Content-Length guard", () => {
    const source = readFileSync("lib/try-on/demo-constants.ts", "utf8");
    assert.match(source, /early Content-Length guard/i);
    assert.doesNotMatch(source, /hard cap\b(?!;)/i);
  });
});

describe("try-on session id validation", () => {
  it("accepts canonical UUIDs", () => {
    assert.equal(isValidTryOnSessionId("550e8400-e29b-41d4-a716-446655440000"), true);
    assert.equal(isValidTryOnSessionId("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), true);
  });

  it("rejects malformed session ids", () => {
    const malformed = [
      "",
      "not-a-uuid",
      "12345",
      "550e8400-e29b-41d4-a716",
      "550e8400-e29b-41d4-a716-446655440000-extra",
      "550e8400e29b41d4a716446655440000",
      "../../etc/passwd",
      "550e8400-e29b-41d4-a716-44665544000g",
      "' OR 1=1--",
    ];

    for (const value of malformed) {
      assert.equal(isValidTryOnSessionId(value), false, `expected rejection: ${value}`);
    }
  });

  it("reports malformed ids with the same message as a missing session", () => {
    const authSource = readFileSync("lib/try-on/sessions/auth.ts", "utf8");

    assert.equal(TRY_ON_SESSION_NOT_FOUND_MESSAGE, "Session not found.");
    assert.ok(
      authSource.includes(`status: 404, message: "${TRY_ON_SESSION_NOT_FOUND_MESSAGE}"`),
      "malformed ids must be indistinguishable from a missing session",
    );
  });

  it("validates the session id before any authorization or database work", () => {
    for (const route of SESSION_ID_ROUTES) {
      const source = readFileSync(route, "utf8");
      const guardIndex = source.lastIndexOf("isValidTryOnSessionId(");
      const authIndex = source.indexOf("await authorizeSessionAccess(");

      assert.ok(guardIndex > -1, `${route} must validate the session id`);
      assert.ok(authIndex > -1, `${route} must still authorize session access`);
      assert.ok(
        guardIndex < authIndex,
        `${route} must validate the session id before authorization`,
      );
    }
  });

  it("answers malformed ids with a generic no-store 404 on every session route", () => {
    for (const route of SESSION_ID_ROUTES) {
      const source = readFileSync(route, "utf8");
      assert.match(
        source,
        /genericErrorResponse\(TRY_ON_SESSION_NOT_FOUND_MESSAGE, 404\)/,
        `${route} must answer malformed ids with a generic 404`,
      );
    }
  });
});

describe("Inngest production dev-mode guard", () => {
  it("never enables dev mode under NODE_ENV=production", () => {
    assert.equal(resolveInngestDevMode({ NODE_ENV: "production", INNGEST_DEV: "1" }), false);
  });

  it("enables dev mode in development when INNGEST_DEV=1", () => {
    assert.equal(resolveInngestDevMode({ NODE_ENV: "development", INNGEST_DEV: "1" }), true);
  });

  it("leaves dev mode disabled when INNGEST_DEV is absent", () => {
    assert.equal(resolveInngestDevMode({ NODE_ENV: "development" }), false);
    assert.equal(resolveInngestDevMode({ NODE_ENV: "production" }), false);
    assert.equal(resolveInngestDevMode({}), false);
  });

  it("keeps existing behavior when NODE_ENV is unset", () => {
    assert.equal(resolveInngestDevMode({ INNGEST_DEV: "1" }), true);
    assert.equal(resolveInngestDevMode({ INNGEST_DEV: "0" }), false);
  });

  it("still fails closed in production when the Inngest event key is missing", () => {
    // NODE_ENV is typed read-only by the Next.js env declarations.
    const env = process.env as Record<string, string | undefined>;
    const previous = {
      NODE_ENV: env.NODE_ENV,
      INNGEST_DEV: env.INNGEST_DEV,
      INNGEST_EVENT_KEY: env.INNGEST_EVENT_KEY,
    };

    env.NODE_ENV = "production";
    env.INNGEST_DEV = "1";
    delete env.INNGEST_EVENT_KEY;

    try {
      assert.throws(
        () => assertInngestEventSendingConfigured(),
        /Inngest event configuration/,
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
    }
  });
});
