import "server-only";

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
    return genericErrorResponse("Service temporarily unavailable.", 503);
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
    readSessionAccessToken,
    tokensMatch,
    createPersonUploadUrl,
    insertTryOnSession,
    deletePendingUploadSession,
    removePersonPhoto,
    setSessionAccessCookie,
    generateSessionAccessToken,
    buildPersonStoragePath,
    computeInitialSessionExpiry,
  });

  if ("error" in result) {
    return genericErrorResponse(result.error, result.status);
  }

  return jsonNoStore(result.body, { status: result.status });
}
