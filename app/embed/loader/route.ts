import { merchantEmbedLoaderSource } from "@/lib/catalog/merchant-embed";

export function GET() {
  return new Response(merchantEmbedLoaderSource(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
