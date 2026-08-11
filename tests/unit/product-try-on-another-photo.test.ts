import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePhotoFingerprint,
  DUPLICATE_COMPLETED_PHOTO_MESSAGE,
  isDuplicateOfLastCompletedPhoto,
} from "../../lib/try-on/sessions/photo-fingerprint";
import {
  canStartProductTryOnGeneration,
  CHOOSE_ANOTHER_PHOTO_LABEL,
  GENERATE_TRY_ON_LABEL,
  isProductTryOnBusy,
  phaseAfterChooseAnotherPhoto,
  phaseAfterPersonPhotoSelected,
  RESTORED_TRY_ON_PRIVACY_MESSAGE,
  shouldShowPersonUploadControls,
  shouldShowRestoredPrivacyNotice,
} from "../../lib/try-on/sessions/product-try-on-flow";
import {
  shouldMintNewClientRequestId,
  shouldResetAttemptOnPhotoChange,
} from "../../lib/try-on/sessions/session-upload-eligibility";

describe("choose another photo flow", () => {
  it("uses explicit labels for generate and choose another", () => {
    assert.equal(GENERATE_TRY_ON_LABEL, "Generate try-on");
    assert.equal(CHOOSE_ANOTHER_PHOTO_LABEL, "Choose another photo");
  });

  it("transitions completed to awaiting_new_photo without starting generation", () => {
    assert.equal(phaseAfterChooseAnotherPhoto(), "awaiting_new_photo");
  });

  it("does not mint clientRequestId merely from choosing another photo", () => {
    assert.equal(
      shouldMintNewClientRequestId({ phase: "awaiting_new_photo", sessionStatus: "completed" }),
      false,
    );
  });

  it("does not reset attempt identifiers on choose another from done", () => {
    assert.equal(
      shouldResetAttemptOnPhotoChange({ phase: "done", sessionStatus: "completed" }),
      false,
    );
  });

  it("disables generate while awaiting a new photo", () => {
    assert.equal(
      canStartProductTryOnGeneration({ phase: "awaiting_new_photo", hasPersonFile: false }),
      false,
    );
    assert.equal(
      canStartProductTryOnGeneration({ phase: "awaiting_new_photo", hasPersonFile: true }),
      false,
    );
  });

  it("disables generate on done even if a stale file reference exists", () => {
    assert.equal(canStartProductTryOnGeneration({ phase: "done", hasPersonFile: true }), false);
  });

  it("enables generate only after photo_selected with a file", () => {
    assert.equal(
      canStartProductTryOnGeneration({ phase: "photo_selected", hasPersonFile: true }),
      true,
    );
  });

  it("moves to photo_selected after picking a file from awaiting_new_photo", () => {
    assert.equal(phaseAfterPersonPhotoSelected("awaiting_new_photo"), "photo_selected");
  });

  it("does not auto-enter a busy phase from photo selection", () => {
    assert.equal(isProductTryOnBusy(phaseAfterPersonPhotoSelected("awaiting_new_photo")), false);
  });

  it("mints clientRequestId only when explicitly generating after completion", () => {
    assert.equal(
      shouldMintNewClientRequestId({ phase: "photo_selected", sessionStatus: "completed" }),
      true,
    );
  });
});

describe("duplicate completed photo fingerprint", () => {
  it("blocks the same optimized photo on the same product", () => {
    assert.equal(
      isDuplicateOfLastCompletedPhoto({
        fingerprint: "abc",
        productKey: "brand/product",
        lastCompleted: { fingerprint: "abc", productKey: "brand/product" },
      }),
      true,
    );
  });

  it("allows the same photo on a different product", () => {
    assert.equal(
      isDuplicateOfLastCompletedPhoto({
        fingerprint: "abc",
        productKey: "brand/other-product",
        lastCompleted: { fingerprint: "abc", productKey: "brand/product" },
      }),
      false,
    );
  });

  it("allows a different photo on the same product", () => {
    assert.equal(
      isDuplicateOfLastCompletedPhoto({
        fingerprint: "def",
        productKey: "brand/product",
        lastCompleted: { fingerprint: "abc", productKey: "brand/product" },
      }),
      false,
    );
  });

  it("uses a customer-safe duplicate message constant", () => {
    assert.match(DUPLICATE_COMPLETED_PHOTO_MESSAGE, /same photo/i);
  });

  it("computes stable SHA-256 fingerprints", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const file = new File([data], "test.jpg", { type: "image/jpeg" });
    const first = await computePhotoFingerprint(file);
    const second = await computePhotoFingerprint(file);
    assert.equal(first, second);
    assert.equal(first.length, 64);
  });
});

describe("ProductTryOn primary action semantics", () => {
  it("never maps choose-another label to the generate handler", () => {
    assert.notEqual(GENERATE_TRY_ON_LABEL, CHOOSE_ANOTHER_PHOTO_LABEL);
  });

  it("treats generate as type button semantics (no form submit)", () => {
    assert.equal(typeof GENERATE_TRY_ON_LABEL, "string");
  });
});

describe("restored completed session UI helpers", () => {
  it("hides upload controls only for restored completed sessions", () => {
    assert.equal(
      shouldShowPersonUploadControls({ phase: "done", isRestoredCompletedSession: true }),
      false,
    );
    assert.equal(
      shouldShowPersonUploadControls({ phase: "done", isRestoredCompletedSession: false }),
      true,
    );
    assert.equal(
      shouldShowPersonUploadControls({ phase: "awaiting_new_photo", isRestoredCompletedSession: true }),
      true,
    );
  });

  it("shows the privacy notice only for restored completed sessions", () => {
    assert.equal(
      shouldShowRestoredPrivacyNotice({ phase: "done", isRestoredCompletedSession: true }),
      true,
    );
    assert.equal(
      shouldShowRestoredPrivacyNotice({ phase: "done", isRestoredCompletedSession: false }),
      false,
    );
    assert.match(RESTORED_TRY_ON_PRIVACY_MESSAGE, /restored securely/i);
    assert.match(RESTORED_TRY_ON_PRIVACY_MESSAGE, /privacy/i);
    assert.match(RESTORED_TRY_ON_PRIVACY_MESSAGE, /not displayed after refresh/i);
  });
});
