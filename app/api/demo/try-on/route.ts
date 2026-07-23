import { handleDemoTryOn } from "@/lib/try-on/demo-handler";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  return handleDemoTryOn(request);
}
