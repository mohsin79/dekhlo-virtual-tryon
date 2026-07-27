import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapLeadRpcError } from "@/lib/leads/lead-api-errors";
import { normalizeLeadEmail, normalizeLeadFullName, normalizeLeadPhone } from "@/lib/leads/normalize";
import { canViewLeads } from "@/lib/leads/permissions";
import { parseLeadCaptureBody } from "@/lib/leads/validation";

describe("lead permissions", () => {
  it("allows owner and admin", () => {
    assert.equal(canViewLeads("owner"), true);
    assert.equal(canViewLeads("admin"), true);
  });

  it("denies editor and analyst", () => {
    assert.equal(canViewLeads("editor"), false);
    assert.equal(canViewLeads("analyst"), false);
  });

  it("does not treat platform role as merchant lead access", () => {
    assert.equal(canViewLeads(null), false);
    assert.equal(canViewLeads(undefined), false);
  });

  it("denies unknown brand roles", () => {
    assert.equal(canViewLeads("unknown" as "owner"), false);
  });
});

describe("lead normalization", () => {
  it("normalizes email to lowercase", () => {
    assert.equal(normalizeLeadEmail("  Shopper@Example.COM  "), "shopper@example.com");
  });

  it("normalizes phone with punctuation", () => {
    assert.equal(normalizeLeadPhone("+92 (300) 123-4567"), "+923001234567");
  });

  it("rejects invalid phone characters", () => {
    assert.equal(normalizeLeadPhone("abc"), null);
  });

  it("trims full name and returns null when empty", () => {
    assert.equal(normalizeLeadFullName("   "), null);
    assert.equal(normalizeLeadFullName("  Ada  "), "Ada");
  });
});

describe("lead capture validation", () => {
  const validBody = {
    fullName: "Ada",
    email: "ada@example.com",
    phone: "+923001234567",
    consentToContact: true,
    consentToMarketing: false,
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    website: "",
  };

  it("accepts valid payload", () => {
    const result = parseLeadCaptureBody(validBody);
    assert.equal(result.success, true);
  });

  it("rejects forbidden brandId field", () => {
    const result = parseLeadCaptureBody({ ...validBody, brandId: validBody.idempotencyKey });
    assert.equal(result.success, false);
  });

  it("rejects honeypot website value", () => {
    const result = parseLeadCaptureBody({ ...validBody, website: "https://spam.example" });
    assert.equal(result.success, false);
  });

  it("requires contact consent true", () => {
    const result = parseLeadCaptureBody({ ...validBody, consentToContact: false });
    assert.equal(result.success, false);
  });

  it("requires UUID idempotency key", () => {
    const result = parseLeadCaptureBody({ ...validBody, idempotencyKey: "not-a-uuid" });
    assert.equal(result.success, false);
  });
});

describe("lead RPC error mapping", () => {
  it("maps session unavailable to 404", () => {
    assert.equal(mapLeadRpcError("LEAD_SESSION_UNAVAILABLE").status, 404);
  });

  it("maps conflict to 409", () => {
    assert.equal(mapLeadRpcError("LEAD_CONFLICT").status, 409);
  });

  it("maps consent errors to 422", () => {
    assert.equal(mapLeadRpcError("LEAD_CONSENT_REQUIRED").status, 422);
  });

  it("sanitizes unexpected errors", () => {
    const mapped = mapLeadRpcError("unexpected postgres detail");
    assert.equal(mapped.status, 500);
    assert.equal(mapped.error.includes("postgres"), false);
  });
});
