import { z } from "zod";
import {
  isLeadEmailLengthValid,
  normalizeLeadEmail,
  normalizeLeadFullName,
  normalizeLeadPhone,
} from "@/lib/leads/normalize";

const forbiddenBodyKeys = [
  "brandId",
  "productId",
  "source",
  "consentedAt",
  "createdAt",
  "metadata",
  "status",
  "sessionToken",
  "accessToken",
  "personStoragePath",
  "resultStoragePath",
  "actor",
  "actorId",
  "actorUserId",
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

export const leadCaptureBodySchema = z
  .object({
    fullName: z.string().optional(),
    email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
    phone: z.string().optional(),
    consentToContact: z.literal(true, { message: "Contact consent is required." }),
    consentToMarketing: z.boolean().optional().default(false),
    idempotencyKey: z.string().uuid("Idempotency key must be a UUID."),
    website: z
      .string()
      .optional()
      .default("")
      .refine((value) => value.trim().length === 0, "Invalid submission."),
  })
  .strict();

export type LeadCaptureBody = z.infer<typeof leadCaptureBodySchema>;

export function parseLeadCaptureBody(body: unknown):
  | { success: true; data: LeadCaptureBody & { normalizedEmail: string; normalizedPhone: string | null; normalizedFullName: string | null } }
  | { success: false; error: string } {
  if (!rejectForbiddenKeys(body)) {
    return { success: false, error: "Request contains forbidden fields." };
  }

  const parsed = leadCaptureBodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const normalizedEmail = normalizeLeadEmail(parsed.data.email);

  if (!isLeadEmailLengthValid(normalizedEmail)) {
    return { success: false, error: "Email is too long." };
  }

  const normalizedFullName = normalizeLeadFullName(parsed.data.fullName ?? null);
  const normalizedPhone = normalizeLeadPhone(parsed.data.phone ?? null);

  if (parsed.data.phone?.trim() && normalizedPhone == null) {
    return { success: false, error: "Enter a valid phone number." };
  }

  return {
    success: true,
    data: {
      ...parsed.data,
      normalizedEmail,
      normalizedFullName,
      normalizedPhone,
    },
  };
}
