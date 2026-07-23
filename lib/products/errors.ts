export function mapProductErrorMessage(
  error: { message?: string; code?: string } | null,
): string {
  if (!error?.message) {
    return "Something went wrong. Please try again.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("duplicate key") || message.includes("products_brand_slug_key") || error.code === "23505") {
    return "That product URL slug is already used in this brand.";
  }

  if (message.includes("row-level security") || error.code === "42501") {
    return "You do not have permission to manage products for this brand.";
  }

  if (message.includes("payload too large") || message.includes("entity too large")) {
    return "Image must be 5 MB or smaller.";
  }

  if (message.includes("invalid") && message.includes("mime")) {
    return "Only JPEG, PNG and WebP images are allowed.";
  }

  return "Something went wrong. Please try again.";
}
