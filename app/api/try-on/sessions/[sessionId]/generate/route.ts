import "server-only";

import {
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
} from "@/lib/api/security";
import { dispatchTryOnGeneration } from "@/lib/try-on/sessions/dispatch-generation";
import { authorizeSessionAccess } from "@/lib/try-on/sessions/auth";
import {
  isValidTryOnSessionId,
  TRY_ON_SESSION_NOT_FOUND_MESSAGE,
} from "@/lib/try-on/sessions/session-id";
import { toPublicSessionStatus } from "@/lib/try-on/sessions/service";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  const { sessionId } = await context.params;

  if (!isValidTryOnSessionId(sessionId)) {
    return genericErrorResponse(TRY_ON_SESSION_NOT_FOUND_MESSAGE, 404);
  }

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

  const dispatched = await dispatchTryOnGeneration({
    sessionId,
    brandId: session.brand_id,
  });

  if (!dispatched.ok) {
    return genericErrorResponse(
      "Generation could not be started. Refresh this page to try again.",
      503,
    );
  }

  return jsonNoStore(
    {
      ...toPublicSessionStatus(session),
      sessionId,
      status: session.status,
    },
    { status: 202 },
  );
}
