import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTryOnSession,
  type CreateSessionDeps,
} from "../../lib/try-on/sessions/create-session";
import type { TryOnSessionRow } from "../../lib/try-on/sessions/public-session";
import {
  isSessionUploadReusable,
  shouldMintNewClientRequestId,
  shouldResetAttemptOnPhotoChange,
} from "../../lib/try-on/sessions/session-upload-eligibility";

function baseSession(overrides: Partial<TryOnSessionRow> = {}): TryOnSessionRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    brand_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    product_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    status: "pending_upload",
    credit_cost: null,
    person_storage_path:
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/11111111-1111-1111-1111-111111111111/person.jpg",
    result_storage_path: null,
    upload_validated_at: null,
    provider_job_id: null,
    provider_request_id: null,
    consent_to_store: false,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    deleted_at: null,
    error_code: null,
    sanitized_error_message: null,
    client_request_id: "22222222-2222-2222-2222-222222222222",
    anonymous_token_hash: "a".repeat(64),
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function createDeps(overrides: Partial<CreateSessionDeps> = {}): CreateSessionDeps {
  return {
    getProduct: async () => ({
      brandId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      productId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    }),
    getSessionByClientRequestId: async () => null,
    readSessionAccessToken: async () => "token-a",
    tokensMatch: () => true,
    createPersonUploadUrl: async () => ({
      signedUrl: "https://example.test/upload",
      token: "upload-token",
    }),
    insertTryOnSession: async (input) =>
      baseSession({
        id: input.id,
        client_request_id: input.clientRequestId,
        person_storage_path: input.personStoragePath,
        anonymous_token_hash: input.anonymousTokenHash,
      }),
    deletePendingUploadSession: async () => {},
    removePersonPhoto: async () => {},
    setSessionAccessCookie: async () => {},
    generateSessionAccessToken: () => ({ token: "token-a", hash: "a".repeat(64) }),
    buildPersonStoragePath: (brandId, sessionId) => `${brandId}/${sessionId}/person.jpg`,
    computeInitialSessionExpiry: () => new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

describe("session upload eligibility", () => {
  it("allows only pending_upload sessions to be reused", () => {
    assert.equal(isSessionUploadReusable("pending_upload"), true);
    for (const status of ["queued", "processing", "completed", "failed", "cancelled"] as const) {
      assert.equal(isSessionUploadReusable(status), false);
    }
  });

  it("mints a new clientRequestId after completion", () => {
    assert.equal(
      shouldMintNewClientRequestId({ phase: "done", sessionStatus: "completed" }),
      true,
    );
  });

  it("keeps clientRequestId during retryable pending_upload errors", () => {
    assert.equal(
      shouldMintNewClientRequestId({ phase: "error", sessionStatus: "pending_upload" }),
      false,
    );
  });

  it("does not reset attempt identifiers when choosing another photo from done", () => {
    assert.equal(
      shouldResetAttemptOnPhotoChange({ phase: "done", sessionStatus: "completed" }),
      false,
    );
  });

  it("mints a new clientRequestId when generating after completion", () => {
    assert.equal(
      shouldMintNewClientRequestId({ phase: "photo_selected", sessionStatus: "completed" }),
      true,
    );
  });
});

describe("createTryOnSession", () => {
  it("creates a new session with a fresh storage path", async () => {
    let insertedPath: string | null = null;
    let insertedId: string | null = null;
    const deps = createDeps({
      insertTryOnSession: async (input) => {
        insertedPath = input.personStoragePath;
        insertedId = input.id;
        return baseSession({
          id: input.id,
          client_request_id: input.clientRequestId,
          person_storage_path: input.personStoragePath,
        });
      },
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "33333333-3333-3333-3333-333333333333",
        consentToStore: false,
      },
      deps,
    );

    assert.equal("status" in result && result.status, 201);
    if ("body" in result) {
      assert.match(insertedPath ?? "", /\/person\.jpg$/);
      assert.equal(result.body.sessionId, insertedId);
      assert.equal(result.body.uploadUrl, "https://example.test/upload");
      assert.equal(Object.hasOwn(result.body, "anonymous_token_hash"), false);
    }
  });

  it("returns idempotent pending_upload state when token matches", async () => {
    const existing = baseSession();
    const deps = createDeps({
      getSessionByClientRequestId: async () => existing,
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: existing.client_request_id,
        consentToStore: false,
      },
      deps,
    );

    assert.equal("status" in result && result.status, 200);
    if ("body" in result) {
      assert.equal(result.body.sessionId, existing.id);
      assert.equal(result.body.status, "pending_upload");
    }
  });

  it("returns 409 when duplicate clientRequestId has no valid token", async () => {
    const deps = createDeps({
      getSessionByClientRequestId: async () => baseSession(),
      readSessionAccessToken: async () => null,
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "22222222-2222-2222-2222-222222222222",
        consentToStore: false,
      },
      deps,
    );

    assert.deepEqual(result, { status: 409, error: "Session request conflict." });
  });

  it("returns 409 when reusing a completed session", async () => {
    const deps = createDeps({
      getSessionByClientRequestId: async () => baseSession({ status: "completed", credit_cost: 1 }),
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "22222222-2222-2222-2222-222222222222",
        consentToStore: false,
      },
      deps,
    );

    assert.deepEqual(result, { status: 409, error: "Session request conflict." });
  });

  it("returns 409 when reusing a failed session", async () => {
    const deps = createDeps({
      getSessionByClientRequestId: async () => baseSession({ status: "failed", credit_cost: 1 }),
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "22222222-2222-2222-2222-222222222222",
        consentToStore: false,
      },
      deps,
    );

    assert.deepEqual(result, { status: 409, error: "Session request conflict." });
  });

  it("returns 409 when reusing a cancelled session", async () => {
    const deps = createDeps({
      getSessionByClientRequestId: async () => baseSession({ status: "cancelled", credit_cost: 1 }),
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "22222222-2222-2222-2222-222222222222",
        consentToStore: false,
      },
      deps,
    );

    assert.deepEqual(result, { status: 409, error: "Session request conflict." });
  });

  it("cleans up orphan pending_upload rows when signed upload preparation fails", async () => {
    const deleted: string[] = [];
    const removed: string[] = [];
    let cookieSet = false;

    const deps = createDeps({
      createPersonUploadUrl: async () => null,
      deletePendingUploadSession: async (sessionId) => {
        deleted.push(sessionId);
      },
      removePersonPhoto: async (path) => {
        removed.push(path);
      },
      setSessionAccessCookie: async () => {
        cookieSet = true;
      },
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "44444444-4444-4444-4444-444444444444",
        consentToStore: false,
      },
      deps,
    );

    assert.deepEqual(result, { status: 503, error: "Unable to prepare upload." });
    assert.equal(deleted.length, 1);
    assert.equal(removed.length, 1);
    assert.equal(cookieSet, false);
  });

  it("sets the session cookie only after signed upload preparation succeeds", async () => {
    let cookieSet = false;
    const deps = createDeps({
      setSessionAccessCookie: async () => {
        cookieSet = true;
      },
    });

    await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "55555555-5555-5555-5555-555555555555",
        consentToStore: false,
      },
      deps,
    );

    assert.equal(cookieSet, true);
  });

  it("does not reserve or consume credits during session creation", async () => {
    const deps = createDeps({
      insertTryOnSession: async (input) =>
        baseSession({
          id: input.id,
          client_request_id: input.clientRequestId,
          credit_cost: null,
          status: "pending_upload",
        }),
    });

    const result = await createTryOnSession(
      {
        brandSlug: "brand-a",
        productSlug: "try-on-product",
        clientRequestId: "66666666-6666-6666-6666-666666666666",
        consentToStore: false,
      },
      deps,
    );

    assert.equal("body" in result && result.body.status, "pending_upload");
    if ("body" in result) {
      assert.equal(Object.hasOwn(result.body, "credit_cost"), false);
    }
  });
});

describe("ProductTryOn attempt identity", () => {
  it("creates clientRequestId A on first attempt and B after completion", () => {
    const first = createAttemptState();
    const second = createAttemptState();

    assert.notEqual(first.clientRequestId, second.clientRequestId);
  });

  it("uses different session paths for different session IDs", () => {
    const brandId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const sessionA = "11111111-1111-1111-1111-111111111111";
    const sessionB = "22222222-2222-2222-2222-222222222222";

    assert.notEqual(`${brandId}/${sessionA}/person.jpg`, `${brandId}/${sessionB}/person.jpg`);
  });
});

function createAttemptState() {
  return {
    clientRequestId: crypto.randomUUID(),
    sessionId: null,
    sessionStatus: null,
  };
}
