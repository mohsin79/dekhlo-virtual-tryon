import "server-only";

import { jsonNoStore, genericErrorResponse } from "@/lib/api/security";
import { getPublicProductBySlugs } from "@/lib/catalog/get-public-product";
import { authorizeSessionAccess } from "@/lib/try-on/sessions/auth";
import { sessionMatchesProductScope } from "@/lib/try-on/sessions/session-product-scope";
import { createResultReadUrl } from "@/lib/try-on/sessions/storage";
import { toPublicSessionStatus } from "@/lib/try-on/sessions/service";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const auth = await authorizeSessionAccess(sessionId);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
  }

  const url = new URL(request.url);
  const brandSlug = url.searchParams.get("brandSlug")?.trim() ?? "";
  const productSlug = url.searchParams.get("productSlug")?.trim() ?? "";

  if (brandSlug && productSlug) {
    const product = await getPublicProductBySlugs(brandSlug, productSlug);

    if (!product || !sessionMatchesProductScope(auth.value.session, product)) {
      return genericErrorResponse("Session not found.", 404);
    }
  }

  const payload = toPublicSessionStatus(auth.value.session);

  if (auth.value.session.status === "completed" && auth.value.session.result_storage_path) {
    const resultUrl = await createResultReadUrl(auth.value.session.result_storage_path);

    return jsonNoStore({
      ...payload,
      resultUrl,
    });
  }

  return jsonNoStore(payload);
}
