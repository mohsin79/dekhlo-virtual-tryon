import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Merchant Payments 2.0 webhook signature.
 * HMAC-SHA512 of the raw body, hexadecimal, compared with X-SFPY-SIGNATURE.
 * The secret is the shared secret from the Safepay dashboard, used as a UTF-8 key.
 */
export function verifySafepayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) {
    return false;
  }

  const provided = signatureHeader.trim().toLowerCase();
  const expected = createHmac("sha512", webhookSecret).update(rawBody, "utf8").digest("hex");
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function signSafepayWebhookBody(rawBody: string, webhookSecret: string): string {
  return createHmac("sha512", webhookSecret).update(rawBody, "utf8").digest("hex");
}
