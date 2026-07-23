import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateSessionAccessToken,
  hashSessionAccessToken,
  tokensMatch,
} from "../../lib/try-on/sessions/token-crypto";
import { validatePersonPhotoBuffer } from "../../lib/try-on/sessions/person-validation";
import { buildPersonStoragePath, buildResultStoragePath } from "../../lib/try-on/sessions/paths";
import {
  computeCompletedSessionExpiry,
  computeInitialSessionExpiry,
} from "../../lib/try-on/sessions/retention";
import { PERSON_PHOTO_MAX_BYTES, SIGNED_URL_TTL_SECONDS } from "../../lib/try-on/sessions/constants";

function minimalPng(width: number, height: number): Buffer {
  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png[1] = 0x50;
  png[2] = 0x4e;
  png[3] = 0x47;
  png[4] = 0x0d;
  png[5] = 0x0a;
  png[6] = 0x1a;
  png[7] = 0x0a;
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

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

function minimalJpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(17);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(9, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

function minimalWebp(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, 4, "ascii");
  buf.write("WEBP", 8, 4, "ascii");
  buf.write("VP8X", 12, 4, "ascii");
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

describe("person photo validation", () => {
  it("rejects empty buffers", () => {
    const result = validatePersonPhotoBuffer(Buffer.alloc(0));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "EMPTY_FILE");
    }
  });

  it("rejects MIME mismatch", () => {
    const png = minimalPng(100, 100);
    const result = validatePersonPhotoBuffer(png, "image/jpeg");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "MIME_MISMATCH");
    }
  });

  it("rejects oversized files", () => {
    const png = Buffer.concat([minimalPng(100, 100), Buffer.alloc(PERSON_PHOTO_MAX_BYTES)]);
    const result = validatePersonPhotoBuffer(png, "image/png");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "FILE_TOO_LARGE");
    }
  });

  it("rejects dimensions above 4096", () => {
    const png = minimalPng(5000, 100);
    const result = validatePersonPhotoBuffer(png, "image/png");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DIMENSIONS_TOO_LARGE");
    }
  });

  it("accepts minimal valid jpeg magic bytes", () => {
    const result = validatePersonPhotoBuffer(minimalJpeg(100, 200), "image/jpeg");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.mimeType, "image/jpeg");
      assert.equal(result.value.width, 100);
      assert.equal(result.value.height, 200);
    }
  });

  it("accepts minimal valid webp magic bytes", () => {
    const result = validatePersonPhotoBuffer(minimalWebp(100, 200), "image/webp");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.mimeType, "image/webp");
      assert.equal(result.value.width, 100);
      assert.equal(result.value.height, 200);
    }
  });

  it("accepts minimal valid png", () => {
    const result = validatePersonPhotoBuffer(minimalPng(100, 200), "image/png");
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

describe("retention metadata", () => {
  it("sets incomplete sessions to expire within 24 hours", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const expiry = computeInitialSessionExpiry(now);
    assert.equal(expiry.toISOString(), "2026-07-24T12:00:00.000Z");
  });

  it("sets completed sessions without consent to 24 hours", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const expiry = computeCompletedSessionExpiry(false, now);
    assert.equal(expiry.toISOString(), "2026-07-24T12:00:00.000Z");
  });

  it("sets completed sessions with consent to 30 days", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const expiry = computeCompletedSessionExpiry(true, now);
    assert.equal(expiry.toISOString(), "2026-08-22T12:00:00.000Z");
  });
});

describe("public session constants", () => {
  it("uses a 15-minute signed URL TTL", () => {
    assert.equal(SIGNED_URL_TTL_SECONDS, 15 * 60);
  });
});
