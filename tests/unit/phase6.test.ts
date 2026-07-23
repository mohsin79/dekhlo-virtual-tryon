import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateSessionAccessToken,
  hashSessionAccessToken,
  tokensMatch,
} from "../../lib/try-on/sessions/token-crypto";
import { validatePersonPhotoBuffer } from "../../lib/try-on/sessions/person-validation";
import { buildPersonStoragePath, buildResultStoragePath } from "../../lib/try-on/sessions/paths";

describe("session access tokens", () => {
  it("hashes tokens to 64-char hex", () => {
    const { token, hash } = generateSessionAccessToken();
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashSessionAccessToken(token));
  });

  it("compares tokens in constant time semantics", () => {
    const { token, hash } = generateSessionAccessToken();
    assert.equal(tokensMatch(hash, token), true);
    assert.equal(tokensMatch(hash, "invalid-token"), false);
  });
});

describe("person photo validation", () => {
  it("rejects empty buffers", () => {
    const result = validatePersonPhotoBuffer(Buffer.alloc(0));
    assert.equal(result.ok, false);
  });

  it("accepts minimal valid png", () => {
    const png = Buffer.alloc(24);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    png[4] = 0x0d;
    png[5] = 0x0a;
    png[6] = 0x1a;
    png[7] = 0x0a;
    png.writeUInt32BE(100, 16);
    png.writeUInt32BE(200, 20);

    const result = validatePersonPhotoBuffer(png, "image/png");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.width, 100);
      assert.equal(result.value.height, 200);
    }
  });
});

describe("storage paths", () => {
  it("builds expected person and result paths", () => {
    const brandId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const sessionId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    assert.equal(
      buildPersonStoragePath(brandId, sessionId, "webp"),
      `${brandId}/${sessionId}/person.webp`,
    );
    assert.equal(
      buildResultStoragePath(brandId, sessionId),
      `${brandId}/${sessionId}/result.png`,
    );
  });
});
