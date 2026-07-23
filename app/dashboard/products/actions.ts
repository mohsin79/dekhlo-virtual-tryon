"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/products/constants";
import { mapProductErrorMessage } from "@/lib/products/errors";
import { validateProductImageFile } from "@/lib/products/image-validation";
import { canManageProducts } from "@/lib/products/permissions";
import { buildProductImageStoragePath, isSafeProductImagePath } from "@/lib/products/storage-path";
import { createClient } from "@/lib/supabase/server";
import { productFieldsSchema, productIdSchema } from "@/lib/validation/product";

export type ProductActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

function fieldErrorsFromZod(error: { flatten: () => { fieldErrors: Record<string, string[]> } }) {
  const flattened = error.flatten().fieldErrors;
  const fieldErrors: Record<string, string> = {};

  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) {
      fieldErrors[key] = messages[0];
    }
  }

  return fieldErrors;
}

function parseIsActive(value: FormDataEntryValue | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = String(value).toLowerCase();
  return normalized === "true" || normalized === "on" || normalized === "1";
}

async function removeProductImage(path: string | null | undefined): Promise<void> {
  if (!isSafeProductImagePath(path)) {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);

  if (error) {
    console.warn("[product-image-cleanup] Failed to remove storage object.");
  }
}

function revalidateProductPaths(productId?: string): void {
  revalidatePath("/dashboard/products");

  if (productId) {
    revalidatePath(`/dashboard/products/${productId}/edit`);
  }
}

export async function createProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const context = await requireUserContext("/dashboard/products/new");

  if (!context.currentBrand || !canManageProducts(context.currentRole)) {
    return { error: "You do not have permission to create products." };
  }

  const parsed = productFieldsSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    isActive: parseIsActive(formData.get("isActive")),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const imageResult = await validateProductImageFile(formData.get("image") as File | null, {
    required: true,
  });

  if (!imageResult.ok) {
    return { fieldErrors: { image: imageResult.error.message } };
  }

  const supabase = await createClient();
  const brandId = context.currentBrand.brandId;
  const productId = randomUUID();
  const storagePath = buildProductImageStoragePath(
    brandId,
    productId,
    imageResult.value.mimeType,
  );

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(storagePath, imageResult.value.buffer, {
      contentType: imageResult.value.mimeType,
      upsert: false,
    });

  if (uploadError) {
    return { error: mapProductErrorMessage(uploadError) };
  }

  const { error: insertError } = await supabase.from("products").insert({
    id: productId,
    brand_id: brandId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    product_image_path: storagePath,
    is_active: parsed.data.isActive,
  });

  if (insertError) {
    await removeProductImage(storagePath);
    return { error: mapProductErrorMessage(insertError) };
  }

  revalidateProductPaths();
  redirect("/dashboard/products");
}

export async function updateProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const productIdParsed = productIdSchema.safeParse(formData.get("productId"));

  if (!productIdParsed.success) {
    return { error: "Invalid product." };
  }

  const productId = productIdParsed.data;
  const context = await requireUserContext(`/dashboard/products/${productId}/edit`);

  if (!context.currentBrand || !canManageProducts(context.currentRole)) {
    return { error: "You do not have permission to edit products." };
  }

  const parsed = productFieldsSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    isActive: parseIsActive(formData.get("isActive")),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const brandId = context.currentBrand.brandId;

  const { data: existing, error: readError } = await supabase
    .from("products")
    .select("id, brand_id, product_image_path")
    .eq("id", productId)
    .eq("brand_id", brandId)
    .maybeSingle();

  if (readError) {
    return { error: mapProductErrorMessage(readError) };
  }

  if (!existing) {
    return { error: "Product not found." };
  }

  const imageFile = formData.get("image") as File | null;
  const hasReplacement = imageFile instanceof File && imageFile.size > 0;
  let nextImagePath = existing.product_image_path;
  let uploadedPath: string | null = null;

  if (hasReplacement) {
    const imageResult = await validateProductImageFile(imageFile, { required: true });

    if (!imageResult.ok) {
      return { fieldErrors: { image: imageResult.error.message } };
    }

    uploadedPath = buildProductImageStoragePath(brandId, productId, imageResult.value.mimeType);

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(uploadedPath, imageResult.value.buffer, {
        contentType: imageResult.value.mimeType,
        upsert: false,
      });

    if (uploadError) {
      return { error: mapProductErrorMessage(uploadError) };
    }

    nextImagePath = uploadedPath;
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      is_active: parsed.data.isActive,
      product_image_path: nextImagePath,
    })
    .eq("id", productId)
    .eq("brand_id", brandId);

  if (updateError) {
    if (uploadedPath) {
      await removeProductImage(uploadedPath);
    }

    return { error: mapProductErrorMessage(updateError) };
  }

  if (uploadedPath && existing.product_image_path !== uploadedPath) {
    await removeProductImage(existing.product_image_path);
  }

  revalidateProductPaths(productId);
  redirect("/dashboard/products");
}

export async function deleteProductAction(formData: FormData): Promise<ProductActionState> {
  const productIdParsed = productIdSchema.safeParse(formData.get("productId"));

  if (!productIdParsed.success) {
    return { error: "Invalid product." };
  }

  const productId = productIdParsed.data;
  const context = await requireUserContext("/dashboard/products");

  if (!context.currentBrand || !canManageProducts(context.currentRole)) {
    return { error: "You do not have permission to delete products." };
  }

  const supabase = await createClient();
  const brandId = context.currentBrand.brandId;

  const { data: existing, error: readError } = await supabase
    .from("products")
    .select("id, product_image_path")
    .eq("id", productId)
    .eq("brand_id", brandId)
    .maybeSingle();

  if (readError) {
    return { error: mapProductErrorMessage(readError) };
  }

  if (!existing) {
    return { error: "Product not found." };
  }

  const { error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("brand_id", brandId);

  if (deleteError) {
    return { error: mapProductErrorMessage(deleteError) };
  }

  await removeProductImage(existing.product_image_path);
  revalidateProductPaths();
  redirect("/dashboard/products");
}

export async function toggleProductActiveAction(formData: FormData): Promise<ProductActionState> {
  const productIdParsed = productIdSchema.safeParse(formData.get("productId"));

  if (!productIdParsed.success) {
    return { error: "Invalid product." };
  }

  const productId = productIdParsed.data;
  const context = await requireUserContext("/dashboard/products");

  if (!context.currentBrand || !canManageProducts(context.currentRole)) {
    return { error: "You do not have permission to update products." };
  }

  const makeActive = parseIsActive(formData.get("isActive"));
  const supabase = await createClient();
  const brandId = context.currentBrand.brandId;

  const { error } = await supabase
    .from("products")
    .update({ is_active: makeActive })
    .eq("id", productId)
    .eq("brand_id", brandId);

  if (error) {
    return { error: mapProductErrorMessage(error) };
  }

  revalidateProductPaths(productId);
  return {};
}
