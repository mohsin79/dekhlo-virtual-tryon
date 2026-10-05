import "server-only";

import { z } from "zod";
import { exceedsContentLengthLimit } from "@/lib/api/body-limits";
import {
  assertJsonRequest,
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
  rateLimitedResponse,
  serviceUnavailableResponse,
} from "@/lib/api/security";
import { getPublicProductBySlugs } from "@/lib/catalog/get-public-product";
import { limitSessionCreation } from "@/lib/rate-limit";
import { TRY_ON_MAX_JSON_BODY_BYTES } from "@/lib/try-on/sessions/constants";
import { createTryOnSession } from "@/lib/try-on/sessions/create-session";
import { computeInitialSessionExpiry } from "@/lib/try-on/sessions/retention";
import {
  deletePendingUploadSession,
  getSessionByClientRequestId,
  insertTryOnSession,
} from "@/lib/try-on/sessions/service";
import { createPersonUploadUrl, removePersonPhoto } from "@/lib/try-on/sessions/storage";
import { buildPersonStoragePath } from "@/lib/try-on/sessions/paths";
import {
  EMBED_TRY_ON_HEADER,
  shouldRevealSessionAccessToken,
} from "@/lib/embed/session-presentation";
import {
  generateSessionAccessToken,
  readPresentedSessionAccessToken,
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

  if (
    exceedsContentLengthLimit(request.headers.get("content-length"), TRY_ON_MAX_JSON_BODY_BYTES)
  ) {
    return genericErrorResponse("Request body is too large.", 400);
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

  const rate = await limitSessionCreation(request);

  if (rate.outcome === "limited") {
    return rateLimitedResponse();
  }

  // Fail closed: no session row is inserted and no credit is reserved without a verdict,
  // including when no trustworthy client address is available.
  if (rate.outcome === "unavailable") {
    return serviceUnavailableResponse();
  }

  const result = await createTryOnSession(parsed.data, {
    getProduct: async (brandSlug, productSlug) => {
      const product = await getPublicProductBySlugs(brandSlug, productSlug);

      if (!product) {
        return null;
      }

      return { brandId: product.brandId, productId: product.productId };
    },
    getSessionByClientRequestId,
    readSessionAccessToken: (sessionId) => readPresentedSessionAccessToken(sessionId, request),
    tokensMatch,
    createPersonUploadUrl,
    insertTryOnSession,
    deletePendingUploadSession,
    removePersonPhoto,
    setSessionAccessCookie,
    generateSessionAccessToken,
    buildPersonStoragePath,
    computeInitialSessionExpiry,
    revealSessionAccessToken: shouldRevealSessionAccessToken({
      referer: request.headers.get("referer"),
      host: request.headers.get("host"),
      embedRequested: request.headers.get(EMBED_TRY_ON_HEADER) === "1",
    }),
  });

  if ("error" in result) {
    return genericErrorResponse(result.error, result.status);
  }

  return jsonNoStore(result.body, { status: result.status });
}
