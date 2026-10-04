import "server-only";

import { handleLeadCaptureGet, handleLeadCapturePost } from "@/lib/leads/handle-lead-capture";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return handleLeadCaptureGet(request, sessionId);
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return handleLeadCapturePost(request, sessionId);
}
