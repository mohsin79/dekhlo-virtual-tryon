import { z } from "zod";
import {
  PLATFORM_MAX_CREDIT_AMOUNT,
  PLATFORM_MAX_IDEMPOTENCY_KEY_LENGTH,
  PLATFORM_MAX_REASON_LENGTH,
  PLATFORM_MAX_SEARCH_LENGTH,
} from "@/lib/platform/constants";

const forbiddenBodyKeys = [
  "actor",
  "actorId",
  "actorUserId",
  "platformRole",
  "grantedCredits",
  "reservedCredits",
  "consumedCredits",
  "availableCredits",
] as const;

function rejectForbiddenKeys(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }

  return !forbiddenBodyKeys.some((key) => key in (value as Record<string, unknown>));
}

export const platformCreditMutationBodySchema = z
  .object({
    brandId: z.string().uuid(),
    amount: z
      .number()
      .int("Amount must be a whole number.")
      .positive("Amount must be positive.")
      .max(PLATFORM_MAX_CREDIT_AMOUNT, "Amount exceeds the allowed maximum."),
    reason: z
      .string()
      .trim()
      .min(1, "Reason is required.")
      .max(PLATFORM_MAX_REASON_LENGTH, "Reason is too long."),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, "Idempotency key is required.")
      .max(PLATFORM_MAX_IDEMPOTENCY_KEY_LENGTH, "Idempotency key is too long."),
  })
  .strict();

export function parsePlatformCreditMutationBody(body: unknown) {
  if (!rejectForbiddenKeys(body)) {
    return {
      success: false as const,
      error: "Request contains forbidden fields.",
    };
  }

  const parsed = platformCreditMutationBodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  return {
    success: true as const,
    data: parsed.data,
  };
}

export function parsePlatformPageParam(raw: string | undefined, fallback = 1): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export function parsePlatformSearchParam(raw: string | undefined): string {
  if (!raw) {
    return "";
  }

  return raw.trim().slice(0, PLATFORM_MAX_SEARCH_LENGTH);
}

export function parseUuidParam(raw: string): string | null {
  const parsed = z.string().uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function escapeIlikePattern(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}
