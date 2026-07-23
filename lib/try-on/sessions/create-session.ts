import { randomUUID } from "node:crypto";
import type { TryOnSessionRow } from "@/lib/try-on/sessions/public-session";
import { isSessionUploadReusable } from "@/lib/try-on/sessions/session-upload-eligibility";
import { toPublicSessionStatus } from "@/lib/try-on/sessions/public-session";

export type CreateSessionInput = {
  brandSlug: string;
  productSlug: string;
  clientRequestId: string;
  consentToStore: boolean;
};

export type CreateSessionSuccess = {
  status: 200 | 201;
  body: ReturnType<typeof toPublicSessionStatus> & {
    uploadUrl: string;
    uploadToken: string;
  };
};

export type CreateSessionFailure = {
  status: number;
  error: string;
};

export type CreateSessionResult = CreateSessionSuccess | CreateSessionFailure;

export type CreateSessionDeps = {
  getProduct: (
    brandSlug: string,
    productSlug: string,
  ) => Promise<{ brandId: string; productId: string } | null>;
  getSessionByClientRequestId: (clientRequestId: string) => Promise<TryOnSessionRow | null>;
  readSessionAccessToken: (sessionId: string) => Promise<string | null>;
  tokensMatch: (expectedHash: string, providedToken: string) => boolean;
  createPersonUploadUrl: (path: string) => Promise<{ signedUrl: string; token: string } | null>;
  insertTryOnSession: (input: {
    id: string;
    brandId: string;
    productId: string;
    clientRequestId: string;
    anonymousTokenHash: string;
    personStoragePath: string;
    consentToStore: boolean;
    expiresAt: string;
  }) => Promise<TryOnSessionRow | null>;
  deletePendingUploadSession: (sessionId: string) => Promise<void>;
  removePersonPhoto: (path: string) => Promise<void>;
  setSessionAccessCookie: (sessionId: string, token: string, expiresAt: Date) => Promise<void>;
  generateSessionAccessToken: () => { token: string; hash: string };
  buildPersonStoragePath: (brandId: string, sessionId: string, extension: "jpg") => string;
  computeInitialSessionExpiry: (now?: Date) => Date;
};

function conflictResponse(): CreateSessionFailure {
  return { status: 409, error: "Session request conflict." };
}

function uploadUnavailableResponse(): CreateSessionFailure {
  return { status: 503, error: "Unable to prepare upload." };
}

export async function createTryOnSession(
  input: CreateSessionInput,
  deps: CreateSessionDeps,
): Promise<CreateSessionResult> {
  const product = await deps.getProduct(input.brandSlug, input.productSlug);

  if (!product) {
    return { status: 404, error: "Product not found." };
  }

  const existing = await deps.getSessionByClientRequestId(input.clientRequestId);

  if (existing) {
    if (!isSessionUploadReusable(existing.status)) {
      return conflictResponse();
    }

    const token = await deps.readSessionAccessToken(existing.id);

    if (!token || !deps.tokensMatch(existing.anonymous_token_hash, token)) {
      return conflictResponse();
    }

    const uploadPath = existing.person_storage_path;

    if (!uploadPath) {
      return conflictResponse();
    }

    const signedUpload = await deps.createPersonUploadUrl(uploadPath);

    if (!signedUpload) {
      return uploadUnavailableResponse();
    }

    return {
      status: 200,
      body: {
        ...toPublicSessionStatus(existing),
        uploadUrl: signedUpload.signedUrl,
        uploadToken: signedUpload.token,
      },
    };
  }

  const sessionId = randomUUID();
  const access = deps.generateSessionAccessToken();
  const expiresAt = deps.computeInitialSessionExpiry();
  const personStoragePath = deps.buildPersonStoragePath(product.brandId, sessionId, "jpg");

  const session = await deps.insertTryOnSession({
    id: sessionId,
    brandId: product.brandId,
    productId: product.productId,
    clientRequestId: input.clientRequestId,
    anonymousTokenHash: access.hash,
    personStoragePath,
    consentToStore: input.consentToStore,
    expiresAt: expiresAt.toISOString(),
  });

  if (!session) {
    return { status: 503, error: "Unable to create session." };
  }

  const signedUpload = await deps.createPersonUploadUrl(personStoragePath);

  if (!signedUpload) {
    await deps.removePersonPhoto(personStoragePath);
    await deps.deletePendingUploadSession(sessionId);
    return uploadUnavailableResponse();
  }

  await deps.setSessionAccessCookie(sessionId, access.token, expiresAt);

  return {
    status: 201,
    body: {
      ...toPublicSessionStatus(session),
      uploadUrl: signedUpload.signedUrl,
      uploadToken: signedUpload.token,
    },
  };
}
