import { z } from "zod";

export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeProductSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function suggestProductSlug(name: string): string {
  return normalizeProductSlug(name);
}

export const productFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Product name is required.")
    .max(200, "Product name is too long."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Product slug is required.")
    .max(100, "Product slug is too long.")
    .regex(PRODUCT_SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens only."),
  isActive: z.boolean(),
});

export const productIdSchema = z.string().uuid("Invalid product identifier.");

export type ProductFieldsInput = z.infer<typeof productFieldsSchema>;
