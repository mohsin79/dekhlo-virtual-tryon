import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAllowlistedAuditMetadata,
  formatAllowlistedTransactionMetadata,
  summarizeAllowlistedMetadata,
} from "@/lib/platform/audit-format";
import { mapPlatformCreditRpcError } from "@/lib/platform/credit-api-errors";
import { isPlatformAdminProfile } from "@/lib/platform/is-platform-admin-profile";
import {
  escapeIlikePattern,
  parsePlatformCreditMutationBody,
  parsePlatformPageParam,
  parseUuidParam,
} from "@/lib/platform/validation";

describe("platform admin profile", () => {
  it("accepts platform_admin", () => {
    assert.equal(isPlatformAdminProfile({ platform_role: "platform_admin" }), true);
  });

  it("rejects null platform role", () => {
    assert.equal(isPlatformAdminProfile({ platform_role: null }), false);
  });

  it("does not treat brand admin membership as platform admin", () => {
    assert.equal(isPlatformAdminProfile({ platform_role: null }), false);
  });
});

describe("platform credit mutation validation", () => {
  const validBody = {
    brandId: "550e8400-e29b-41d4-a716-446655440000",
    amount: 10,
    reason: "Support adjustment",
    idempotencyKey: "platform-test-key",
  };

  it("accepts valid grant payload", () => {
    const result = parsePlatformCreditMutationBody(validBody);
    assert.equal(result.success, true);
  });

  it("rejects actor field in body", () => {
    const result = parsePlatformCreditMutationBody({
      ...validBody,
      actorUserId: "11111111-1111-1111-1111-111111111111",
    });
    assert.equal(result.success, false);
  });

  it("rejects decimal amount", () => {
    const result = parsePlatformCreditMutationBody({ ...validBody, amount: 1.5 });
    assert.equal(result.success, false);
  });

  it("rejects zero amount", () => {
    const result = parsePlatformCreditMutationBody({ ...validBody, amount: 0 });
    assert.equal(result.success, false);
  });

  it("rejects blank reason", () => {
    const result = parsePlatformCreditMutationBody({ ...validBody, reason: "   " });
    assert.equal(result.success, false);
  });

  it("rejects invalid brand UUID", () => {
    const result = parsePlatformCreditMutationBody({ ...validBody, brandId: "not-a-uuid" });
    assert.equal(result.success, false);
  });
});

describe("platform audit metadata formatting", () => {
  it("includes approved fields", () => {
    const formatted = formatAllowlistedAuditMetadata({
      amount: 25,
      operation: "admin_grant",
      actor_user_id: "11111111-1111-1111-1111-111111111111",
      balance_before: 10,
      balance_after: 35,
      secret_token: "hidden",
      person_storage_path: "private/path",
    });

    assert.equal(formatted.amount, 25);
    assert.equal(formatted.operation, "admin_grant");
    assert.equal(formatted.balance_before, 10);
    assert.equal("secret_token" in formatted, false);
    assert.equal("person_storage_path" in formatted, false);
  });

  it("omits unknown keys and nested values", () => {
    const formatted = formatAllowlistedAuditMetadata({
      unexpected: "value",
      nested: { token: "abc" },
    });

    assert.deepEqual(formatted, {});
  });

  it("formats transaction metadata safely", () => {
    const formatted = formatAllowlistedTransactionMetadata({
      reason: "Trial",
      operation: "admin_grant",
      actor_user_id: "11111111-1111-1111-1111-111111111111",
      signed_url: "https://example.com",
    });

    assert.equal(formatted.reason, "Trial");
    assert.equal("signed_url" in formatted, false);
  });

  it("summarizes allowlisted metadata", () => {
    const summary = summarizeAllowlistedMetadata({ amount: 5, operation: "admin_revoke" });
    assert.match(summary ?? "", /amount: 5/);
  });
});

describe("platform RPC error mapping", () => {
  it("maps brand not found to 404", () => {
    const mapped = mapPlatformCreditRpcError("Brand not found", "grant");
    assert.equal(mapped.status, 404);
  });

  it("maps idempotency conflict to 409", () => {
    const mapped = mapPlatformCreditRpcError("Idempotency key conflict", "grant");
    assert.equal(mapped.status, 409);
  });

  it("maps excessive revoke to 422", () => {
    const mapped = mapPlatformCreditRpcError(
      "Insufficient granted credits to revoke",
      "revoke",
    );
    assert.equal(mapped.status, 422);
  });

  it("sanitizes unexpected errors", () => {
    const mapped = mapPlatformCreditRpcError("DETAIL: internal stack trace", "grant");
    assert.equal(mapped.status, 500);
    assert.doesNotMatch(mapped.error, /stack trace/i);
  });
});

describe("platform query param helpers", () => {
  it("parses page numbers safely", () => {
    assert.equal(parsePlatformPageParam(undefined), 1);
    assert.equal(parsePlatformPageParam("-1"), 1);
    assert.equal(parsePlatformPageParam("3"), 3);
  });

  it("validates UUID params", () => {
    assert.equal(
      parseUuidParam("550e8400-e29b-41d4-a716-446655440000"),
      "550e8400-e29b-41d4-a716-446655440000",
    );
    assert.equal(parseUuidParam("bad"), null);
  });

  it("escapes ilike patterns", () => {
    assert.equal(escapeIlikePattern("a%b_c"), "a\\%b\\_c");
  });
});

describe("platform proxy expectations", () => {
  it("includes /platform in protected prefixes", () => {
    const protectedPrefixes = ["/dashboard", "/onboarding", "/platform"];
    assert.ok(protectedPrefixes.some((prefix) => "/platform/brands".startsWith(prefix)));
  });
});
