import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isExpectedApplicationError,
  shouldCaptureError,
  shouldCaptureHttpStatus,
  shouldCaptureRpcMappedStatus,
} from "@/lib/observability/capture-policy";
import {
  deepScrub,
  isSensitiveKey,
  sanitizeAllowlistedContext,
  sanitizeUrl,
  scrubSentryEvent,
  shouldDropSentryEvent,
} from "@/lib/observability/sentry-scrub";
import { getSentryDsn } from "@/lib/env";
import {
  isClientSafeTryOnErrorMessage,
  TRY_ON_GENERATION_FAILED_MESSAGE,
  TRY_ON_SERVICE_UNAVAILABLE_MESSAGE,
} from "@/lib/try-on/generation-messages";
import { mapLeadRpcError } from "@/lib/leads/lead-api-errors";
import { mapPlatformCreditRpcError } from "@/lib/platform/credit-api-errors";

describe("Phase 8C.1 scrubbing", () => {
  it("flags sensitive key fragments", () => {
    assert.equal(isSensitiveKey("Authorization"), true);
    assert.equal(isSensitiveKey("set-cookie"), true);
    assert.equal(isSensitiveKey("sessionToken"), true);
    assert.equal(isSensitiveKey("personStoragePath"), true);
    assert.equal(isSensitiveKey("requestBody"), true);
    assert.equal(isSensitiveKey("routeCategory"), false);
  });

  it("redacts deeply nested sensitive fields while preserving safe properties", () => {
    const scrubbed = deepScrub({
      routeCategory: "demo",
      nested: {
        Authorization: "Bearer secret",
        email: "shopper@example.com",
        phone: "+923001234567",
        fullName: "Ada Lovelace",
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        storagePath: "brand/session/person.jpg",
        safeCount: 3,
      },
      items: [
        { api_key: "sk-live", operation: "generate" },
        { cookie: "session=abc", status: "ok" },
      ],
    }) as Record<string, unknown>;

    const nested = scrubbed.nested as Record<string, unknown>;
    assert.equal(nested.Authorization, "[redacted]");
    assert.equal(nested.email, "[redacted]");
    assert.equal(nested.phone, "[redacted]");
    assert.equal(nested.fullName, "[redacted]");
    assert.equal(nested.idempotencyKey, "[redacted]");
    assert.equal(nested.storagePath, "[redacted]");
    assert.equal(nested.safeCount, 3);
    assert.equal(scrubbed.routeCategory, "demo");

    const items = scrubbed.items as Array<Record<string, unknown>>;
    assert.equal(items[0].api_key, "[redacted]");
    assert.equal(items[0].operation, "generate");
    assert.equal(items[1].cookie, "[redacted]");
    assert.equal(items[1].status, "ok");
  });

  it("sanitizes signed URLs and image data URLs", () => {
    const signed = sanitizeUrl(
      "https://project.supabase.co/storage/v1/object/sign/private/x?token=abc123&sig=deadbeef",
    );
    assert.equal(signed.includes("abc123"), false);
    assert.equal(signed.includes("deadbeef"), false);
    assert.equal(signed.toLowerCase().includes("redacted"), true);

    const scrubbed = deepScrub({
      preview: "data:image/jpeg;base64,/9j/4AAQSkZJRg",
    }) as Record<string, string>;

    assert.equal(scrubbed.preview, "[redacted]");
  });

  it("allowlists only safe Sentry context tags", () => {
    const sanitized = sanitizeAllowlistedContext({
      routeCategory: "lead_capture",
      operation: "create_try_on_lead",
      email: "must-not-pass@example.com",
      reason: "admin text",
    });

    assert.deepEqual(sanitized, {
      routeCategory: "lead_capture",
      operation: "create_try_on_lead",
    });
  });

  it("scrubs Sentry events before send", () => {
    const event = scrubSentryEvent({
      message: "failure",
      user: { email: "user@example.com", ip_address: "127.0.0.1" },
      request: {
        url: "https://example.com/api?token=secret",
        cookies: { sb: "token" },
        data: { email: "user@example.com" },
        headers: { Authorization: "Bearer abc", "content-type": "application/json" },
      },
      extra: {
        routeCategory: "demo",
        email: "user@example.com",
        openaiResponse: { id: "resp_123", output: "raw provider payload" },
      },
      breadcrumbs: [
        {
          message: "fetch",
          data: { url: "https://example.com/api?access_token=secret" },
        },
      ],
    });

    assert.equal(event.user?.email, undefined);
    assert.equal(event.user?.ip_address, undefined);
    assert.equal(event.request?.cookies, undefined);
    assert.equal(event.request?.data, undefined);
    assert.equal(event.request?.headers?.Authorization, "[redacted]");
    assert.equal(event.request?.url?.includes("secret"), false);
    assert.equal(event.extra?.email, undefined);
    assert.equal(event.extra?.routeCategory, "demo");
    assert.equal(event.extra?.openaiResponse, undefined);
    assert.equal(event.breadcrumbs?.[0]?.data?.url?.includes("secret"), false);
  });
});

describe("Phase 8C.1 capture policy", () => {
  it("does not capture expected HTTP statuses", () => {
    for (const status of [400, 401, 403, 404, 409, 410, 415, 422, 429]) {
      assert.equal(shouldCaptureHttpStatus(status), false);
    }
  });

  it("captures unexpected 500-class statuses", () => {
    assert.equal(shouldCaptureHttpStatus(500), true);
    assert.equal(shouldCaptureHttpStatus(502), true);
    assert.equal(shouldCaptureHttpStatus(503), true);
  });

  it("drops Sentry events tagged with expected HTTP statuses", () => {
    assert.equal(
      shouldDropSentryEvent({
        tags: { httpStatus: "404" },
      }),
      true,
    );
    assert.equal(
      shouldDropSentryEvent({
        tags: { httpStatus: "500" },
      }),
      false,
    );
  });

  it("does not capture expected application errors", () => {
    const permanent = new Error("Validated photo is unavailable.");
    permanent.name = "TryOnWorkerPermanentError";

    assert.equal(isExpectedApplicationError(permanent), true);
    assert.equal(shouldCaptureError(permanent), false);
  });

  it("captures unexpected infrastructure errors", () => {
    assert.equal(shouldCaptureError(new Error("connection reset")), true);
    assert.equal(shouldCaptureError(new Error("connection reset"), 500), true);
    assert.equal(shouldCaptureError(new Error("validation"), 422), false);
  });

  it("captures only unmapped RPC failures for lead and platform APIs", () => {
    assert.equal(shouldCaptureRpcMappedStatus(mapLeadRpcError("LEAD_CONFLICT").status), false);
    assert.equal(
      shouldCaptureRpcMappedStatus(mapLeadRpcError("unexpected postgres detail").status),
      true,
    );
    assert.equal(
      shouldCaptureRpcMappedStatus(mapPlatformCreditRpcError("brand not found", "grant").status),
      false,
    );
    assert.equal(
      shouldCaptureRpcMappedStatus(
        mapPlatformCreditRpcError("unexpected database failure", "revoke").status,
      ),
      true,
    );
  });

  it("does not treat transient worker retries as expected application errors", () => {
    const retryable = new Error("Try-on generation failed.");
    assert.equal(isExpectedApplicationError(retryable), false);
    assert.equal(shouldCaptureError(retryable), true);
  });
});

describe("Phase 8C.1 demo generation sanitization", () => {
  it("never exposes provider configuration hints in client-safe messages", () => {
    assert.equal(isClientSafeTryOnErrorMessage(TRY_ON_SERVICE_UNAVAILABLE_MESSAGE), true);
    assert.equal(
      isClientSafeTryOnErrorMessage(
        "The try-on service is not configured yet. Add OPENAI_API_KEY to your environment.",
      ),
      false,
    );
  });

  it("uses a generic client-safe generation failure message", () => {
    assert.equal(
      TRY_ON_GENERATION_FAILED_MESSAGE,
      "Try-on generation failed. Please try again.",
    );
    assert.equal(isClientSafeTryOnErrorMessage(TRY_ON_GENERATION_FAILED_MESSAGE), true);
    assert.equal(
      isClientSafeTryOnErrorMessage("401 Incorrect API key provided: sk-live-secret"),
      false,
    );
  });
});

describe("Phase 8C.1 environment", () => {
  it("treats missing SENTRY_DSN as a safe no-op", () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;

    try {
      assert.equal(getSentryDsn(), undefined);
    } finally {
      if (previous === undefined) {
        delete process.env.SENTRY_DSN;
      } else {
        process.env.SENTRY_DSN = previous;
      }
    }
  });

  it("does not read SENTRY_AUTH_TOKEN in application runtime modules", async () => {
    const envModule = await import("@/lib/env");
    assert.equal("getSentryAuthToken" in envModule, false);
    assert.equal(typeof envModule.getSentryDsn, "function");
  });
});
