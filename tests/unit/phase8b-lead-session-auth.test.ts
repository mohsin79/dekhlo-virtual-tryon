import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LEAD_UNAVAILABLE_MESSAGE } from "@/lib/leads/constants";
import { evaluateLeadSessionAuthorization } from "@/lib/try-on/sessions/lead-session-auth-logic";
import { hashSessionAccessToken } from "@/lib/try-on/sessions/token-crypto";

describe("evaluateLeadSessionAuthorization", () => {
  const token = "test-session-token";
  const tokenHash = hashSessionAccessToken(token);

  it("returns 401 when session cookie is missing", () => {
    const result = evaluateLeadSessionAuthorization({ token: null, session: null });
    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.status, 401);
    }
  });

  it("returns enumeration-resistant 404 when session is missing", () => {
    const result = evaluateLeadSessionAuthorization({ token, session: null });
    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.status, 404);
      assert.equal(result.message, LEAD_UNAVAILABLE_MESSAGE);
    }
  });

  it("returns enumeration-resistant 404 when token does not match", () => {
    const result = evaluateLeadSessionAuthorization({
      token,
      session: {
        anonymous_token_hash: "f".repeat(64),
        deleted_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.status, 404);
      assert.equal(result.message, LEAD_UNAVAILABLE_MESSAGE);
    }
  });

  it("returns 410 when session is expired with valid token", () => {
    const result = evaluateLeadSessionAuthorization({
      token,
      session: {
        anonymous_token_hash: tokenHash,
        deleted_at: null,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.status, 410);
    }
  });

  it("returns 410 when session is soft-deleted with valid token", () => {
    const result = evaluateLeadSessionAuthorization({
      token,
      session: {
        anonymous_token_hash: tokenHash,
        deleted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.status, 410);
    }
  });

  it("accepts a valid active session", () => {
    const result = evaluateLeadSessionAuthorization({
      token,
      session: {
        anonymous_token_hash: tokenHash,
        deleted_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    assert.equal(result.ok, true);
  });
});

describe("lead handler cache behavior", () => {
  it("uses jsonNoStore for GET and POST handlers", () => {
    const source = readFileSync("lib/leads/handle-lead-capture.ts", "utf8");
    assert.match(source, /jsonNoStore\(/);
  });
});
