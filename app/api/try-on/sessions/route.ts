import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assertJsonRequest,
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
  rateLimitedResponse,
} from "@/lib/api/security";
import { getPublicProductBySlugs } from "@/lib/catalog/get-public-product";
import { getClientIp, limitSessionCreation } from "@/lib/rate-limit";
import { computeInitialSessionExpiry } from "@/lib/try-on/sessions/retention";
import {
  getSessionByClientRequestId,
  insertTryOnSession,
  toPublicSessionStatus,
} from "@/lib/try-on/sessions/service";
import { createPersonUploadUrl } from "@/lib/try-on/sessions/storage";
import { buildPersonStoragePath } from "@/lib/try-on/sessions/paths";
import {
  generateSessionAccessToken,
  readSessionAccessToken,
  setSessionAccessCookie,
  tokensMatch,
} from "@/lib/try-on/sessions/tokens";

const createSessionSchema = z.object({
  brandSlug: z.string().trim().min(1).max(120),
  productSlug: z.string().trim().min(1).max(120),
  clientRequestId: z.string().uuid(),
  consentToStore: z.boolean(),
});

export async function POST(request: Request) {
  if (!assertJsonRequest(request)) {
    return genericErrorResponse("Expected application/json.", 415);
  }

  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return genericErrorResponse("Invalid JSON body.", 400);
  }

  const parsed = createSessionSchema.safeParse(body);

  if (!parsed.success) {
    return genericErrorResponse("Invalid session request.", 400);
  }

  try {
    const ip = getClientIp(request);
    const rate = await limitSessionCreation(ip);

    if (!rate.success) {
      return rateLimitedResponse();
    }
  } catch {
    return rateLimitedResponse();
  }

  const product = await getPublicProductBySlugs(parsed.data.brandSlug, parsed.data.productSlug);

  if (!product) {
    return genericErrorResponse("Product not found.", 404);
  }

  const existing = await getSessionByClientRequestId(parsed.data.clientRequestId);

  if (existing) {
    const token = await readSessionAccessToken(existing.id);

    if (!token || !tokensMatch(existing.anonymous_token_hash, token)) {
      return genericErrorResponse("Session request conflict.", 409);
    }

    const uploadPath = existing.person_storage_path;

    if (!uploadPath) {
      return genericErrorResponse("Session is unavailable.", 409);
    }

    const signedUpload = await createPersonUploadUrl(uploadPath);

    if (!signedUpload) {
      return genericErrorResponse("Unable to prepare upload.", 503);
    }

    return jsonNoStore({
      ...toPublicSessionStatus(existing),
      uploadUrl: signedUpload.signedUrl,
      uploadToken: signedUpload.token,
    });
  }

  const sessionId = randomUUID();
  const access = generateSessionAccessToken();
  const expiresAt = computeInitialSessionExpiry();
  const personStoragePath = buildPersonStoragePath(
    product.brandId,
    sessionId,
    "jpg",
  );

  const session = await insertTryOnSession({
    id: sessionId,
    brandId: product.brandId,
    productId: product.productId,
    clientRequestId: parsed.data.clientRequestId,
    anonymousTokenHash: access.hash,
    personStoragePath,
    consentToStore: parsed.data.consentToStore,
    expiresAt: expiresAt.toISOString(),
  });

  if (!session) {
    return genericErrorResponse("Unable to create session.", 503);
  }

  await setSessionAccessCookie(sessionId, access.token, expiresAt);

  const signedUpload = await createPersonUploadUrl(personStoragePath);

  if (!signedUpload) {
    return genericErrorResponse("Unable to prepare upload.", 503);
  }

  return jsonNoStore(
    {
      ...toPublicSessionStatus(session),
      uploadUrl: signedUpload.signedUrl,
      uploadToken: signedUpload.token,
    },
    { status: 201 },
  );
}
