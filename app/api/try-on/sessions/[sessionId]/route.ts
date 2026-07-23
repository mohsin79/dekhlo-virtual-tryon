import "server-only";

import { jsonNoStore, genericErrorResponse } from "@/lib/api/security";
import { authorizeSessionAccess } from "@/lib/try-on/sessions/auth";
import { createResultReadUrl } from "@/lib/try-on/sessions/storage";
import { toPublicSessionStatus } from "@/lib/try-on/sessions/service";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const auth = await authorizeSessionAccess(sessionId);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
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
