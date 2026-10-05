import { jsonNoStore } from "@/lib/api/security";
import { SafepayConfigError } from "@/lib/payments/safepay/config";
import { receiveSafepayWebhook } from "@/lib/payments/credit-pack-service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    const result = await receiveSafepayWebhook(
      rawBody,
      request.headers.get("x-sfpy-signature"),
    );

    if (result.status === 401) {
      return jsonNoStore({ error: "Invalid signature." }, { status: 401 });
    }

    if (result.status === 400) {
      return jsonNoStore({ error: "Invalid payload." }, { status: 400 });
    }

    if (result.status === 413) {
      return jsonNoStore({ error: "Payload is too large." }, { status: 413 });
    }

    if (result.status === 500) {
      return jsonNoStore({ error: "Unable to confirm payment." }, { status: 500 });
    }

    return jsonNoStore({ received: true });
  } catch (error) {
    if (error instanceof SafepayConfigError) {
      console.error("[payments] webhook_unconfigured");
      return jsonNoStore({ error: "Payments are not configured." }, { status: 503 });
    }

    console.error("[payments] webhook_failed");
    return jsonNoStore({ error: "Unable to confirm payment." }, { status: 500 });
  }
}
