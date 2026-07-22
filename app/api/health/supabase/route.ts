import { getInternalHealthSecret } from "@/lib/env";
import { verifySupabaseConnection } from "@/lib/supabase/health";

export const runtime = "nodejs";

function isHealthEndpointAllowed(request: Request): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const secret = getInternalHealthSecret();
  if (!secret) {
    return false;
  }

  return request.headers.get("x-internal-health-secret") === secret;
}

function healthResponse(body: { status: "ok" | "error" }, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  if (!isHealthEndpointAllowed(request)) {
    return healthResponse({ status: "error" }, 404);
  }

  try {
    const ok = await verifySupabaseConnection();
    if (!ok) {
      return healthResponse({ status: "error" }, 503);
    }
    return healthResponse({ status: "ok" }, 200);
  } catch {
    return healthResponse({ status: "error" }, 503);
  }
}
