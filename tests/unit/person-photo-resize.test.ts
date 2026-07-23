import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeResizeDimensions,
  preparePersonPhotoForUpload,
  validatePersonPhotoMimeType,
  type CanvasLike,
  type ImageBitmapLike,
  type PersonPhotoResizeDeps,
} from "../../lib/try-on/sessions/person-photo-resize";

describe("computeResizeDimensions", () => {
  it("keeps 3000 x 4000 unchanged", () => {
    const result = computeResizeDimensions(3000, 4000);
    assert.deepEqual(result, { width: 3000, height: 4000, needsResize: false });
  });

  it("keeps 4096 x 4096 unchanged", () => {
    const result = computeResizeDimensions(4096, 4096);
    assert.deepEqual(result, { width: 4096, height: 4096, needsResize: false });
  });

  it("scales 4032 x 5712 to fit within 4096", () => {
    const result = computeResizeDimensions(4032, 5712);
    assert.equal(result.needsResize, true);
    assert.equal(result.height, 4096);
    assert.ok(Math.abs(result.width - 2890) <= 1);
    assert.ok(result.width <= 4096);
    assert.ok(result.height <= 4096);
    assert.ok(Math.abs(result.width / result.height - 4032 / 5712) < 0.01);
  });

  it("scales 6000 x 4000 with width as the long side", () => {
    const result = computeResizeDimensions(6000, 4000);
    assert.equal(result.needsResize, true);
    assert.equal(result.width, 4096);
    assert.ok(Math.abs(result.height - 2731) <= 1);
    assert.ok(result.width <= 4096);
    assert.ok(result.height <= 4096);
    assert.ok(Math.abs(result.width / result.height - 6000 / 4000) < 0.01);
  });

  it("never exceeds 4096 on either axis", () => {
    const result = computeResizeDimensions(8000, 12000);
    assert.equal(result.needsResize, true);
    assert.ok(result.width <= 4096);
    assert.ok(result.height <= 4096);
    assert.equal(result.height, 4096);
  });
});

describe("validatePersonPhotoMimeType", () => {
  it("accepts jpeg, png and webp", () => {
    assert.equal(validatePersonPhotoMimeType("image/jpeg"), null);
    assert.equal(validatePersonPhotoMimeType("image/png"), null);
    assert.equal(validatePersonPhotoMimeType("image/webp"), null);
  });

  it("rejects unsupported formats", () => {
    for (const mimeType of [
      "image/heic",
      "image/gif",
      "image/svg+xml",
      "image/tiff",
      "text/html",
      "application/pdf",
    ]) {
      const result = validatePersonPhotoMimeType(mimeType);
      assert.ok(result);
      assert.equal(result?.code, "UNSUPPORTED_FORMAT");
    }
  });
});

describe("preparePersonPhotoForUpload", () => {
  function createDeps(input: {
    width: number;
    height: number;
    blobFactory?: (canvas: CanvasLike, mimeType: string) => Blob;
  }): PersonPhotoResizeDeps {
    const bitmap: ImageBitmapLike = {
      width: input.width,
      height: input.height,
      close: () => {},
    };

    return {
      createImageBitmap: async () => bitmap,
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => ({
          drawImage: () => {},
        }),
      }),
      canvasToBlob: async (canvas, mimeType) =>
        input.blobFactory?.(canvas, mimeType) ??
        new Blob(["resized"], { type: mimeType }),
    };
  }

  it("returns the original file when no resize is needed", async () => {
    const original = new File(["original"], "photo.jpg", { type: "image/jpeg" });
    const result = await preparePersonPhotoForUpload(
      original,
      createDeps({ width: 3000, height: 4000 }),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.file, original);
      assert.equal(result.value.wasResized, false);
    }
  });

  it("returns a resized file when dimensions exceed 4096", async () => {
    const original = new File(["original"], "photo.jpg", { type: "image/jpeg" });
    const result = await preparePersonPhotoForUpload(
      original,
      createDeps({ width: 4032, height: 5712 }),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.value.file, original);
      assert.equal(result.value.wasResized, true);
      assert.ok(result.value.width <= 4096);
      assert.ok(result.value.height <= 4096);
      assert.equal(result.value.mimeType, "image/jpeg");
    }
  });

  it("returns a safe error when resizing fails", async () => {
    const original = new File(["original"], "photo.webp", { type: "image/webp" });
    const result = await preparePersonPhotoForUpload(original, {
      createImageBitmap: async () => {
        throw new Error("decode failed");
      },
      createCanvas: () => ({
        width: 1,
        height: 1,
        getContext: () => null,
      }),
      canvasToBlob: async () => null,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "RESIZE_FAILED");
      assert.match(result.error.message, /could not be prepared/i);
    }
  });

  it("rejects resized output larger than 8 MB", async () => {
    const original = new File(["original"], "photo.png", { type: "image/png" });
    const result = await preparePersonPhotoForUpload(original, {
      ...createDeps({ width: 5000, height: 5000 }),
      canvasToBlob: async (_canvas, mimeType) => new Blob([Buffer.alloc(8 * 1024 * 1024 + 1)], { type: mimeType }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "FILE_TOO_LARGE");
      assert.match(result.error.message, /JPEG or WebP/i);
    }
  });

  it("rejects empty resized output", async () => {
    const original = new File(["original"], "photo.jpg", { type: "image/jpeg" });
    const result = await preparePersonPhotoForUpload(original, {
      ...createDeps({ width: 5000, height: 5000 }),
      canvasToBlob: async () => new Blob([], { type: "image/jpeg" }),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "RESIZE_FAILED");
    }
  });

  it("keeps PNG output type for transparent PNG inputs", async () => {
    const original = new File(["original"], "photo.png", { type: "image/png" });
    const result = await preparePersonPhotoForUpload(
      original,
      createDeps({ width: 5000, height: 5000 }),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.mimeType, "image/png");
      assert.equal(result.value.file.type, "image/png");
      assert.ok(result.value.file.size > 0);
    }
  });

  it("rejects unsupported mime types before decoding", async () => {
    const original = new File(["original"], "photo.heic", { type: "image/heic" });
    const result = await preparePersonPhotoForUpload(original, createDeps({ width: 1000, height: 1000 }));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "UNSUPPORTED_FORMAT");
    }
  });
});
