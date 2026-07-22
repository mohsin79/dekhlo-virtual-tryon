import { z } from "zod";

export const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeBrandSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function suggestBrandSlug(name: string): string {
  return normalizeBrandSlug(name);
}

export const brandOnboardingSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Brand name is required.")
    .max(200, "Brand name is too long."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Brand slug is required.")
    .max(100, "Brand slug is too long.")
    .regex(BRAND_SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens only."),
});

export type BrandOnboardingInput = z.infer<typeof brandOnboardingSchema>;
