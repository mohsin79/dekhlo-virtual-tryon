export function mapPlatformCreditRpcError(message: string, operation: "grant" | "revoke"): {
  status: number;
  error: string;
} {
  const normalized = message.toLowerCase();

  if (normalized.includes("brand not found")) {
    return { status: 404, error: "Brand not found." };
  }

  if (normalized.includes("idempotency key conflict")) {
    return { status: 409, error: "Idempotency key conflict." };
  }

  if (
    operation === "revoke" &&
    normalized.includes("insufficient granted credits to revoke")
  ) {
    return { status: 422, error: "Revoke amount exceeds available credits." };
  }

  if (normalized.includes("platform administrator authorization required")) {
    return { status: 403, error: "Platform administrator access required." };
  }

  if (
    normalized.includes("amount must be a positive integer") ||
    normalized.includes("reason is required") ||
    normalized.includes("reason is too long") ||
    normalized.includes("idempotency key is required") ||
    normalized.includes("idempotency key is too long") ||
    normalized.includes("actor is required") ||
    normalized.includes("brand is required")
  ) {
    return { status: 400, error: "Invalid credit operation request." };
  }

  return { status: 500, error: "Unable to complete credit operation." };
}
