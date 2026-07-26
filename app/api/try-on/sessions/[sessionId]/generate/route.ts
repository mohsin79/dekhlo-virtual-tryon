import "server-only";

import {
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
} from "@/lib/api/security";
import { dispatchTryOnGeneration } from "@/lib/try-on/sessions/dispatch-generation";
import { authorizeSessionAccess } from "@/lib/try-on/sessions/auth";
import { toPublicSessionStatus } from "@/lib/try-on/sessions/service";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  const { sessionId } = await context.params;
  const auth = await authorizeSessionAccess(sessionId);

  if (!auth.ok) {
    return genericErrorResponse(auth.message, auth.status);
  }

  const session = auth.value.session;

  if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
    return genericErrorResponse("Session is not eligible for generation dispatch.", 409);
  }

  if (session.status !== "queued" && session.status !== "processing") {
    return genericErrorResponse("Session is not ready for generation.", 409);
  }

  await dispatchTryOnGeneration({
    sessionId,
    brandId: session.brand_id,
  });

  return jsonNoStore(
    {
      ...toPublicSessionStatus(session),
      sessionId,
      status: session.status,
    },
    { status: 202 },
  );
}
