import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/components/products/product-form";
import { ProductImage } from "@/components/products/product-image";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { canManageProducts, isReadOnlyProductRole } from "@/lib/products/permissions";
import { getProductImagePublicUrl } from "@/lib/products/public-url";
import { createClient } from "@/lib/supabase/server";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const context = await requireUserContext(`/dashboard/products/${productId}/edit`);

  if (!context.currentBrand) {
    redirect("/dashboard/products");
  }

  const supabase = await createClient();
  const { data: product, error } = await supabase
    .from("products")
    .select("id, name, slug, is_active, product_image_path, brand_id")
    .eq("id", productId)
    .eq("brand_id", context.currentBrand.brandId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!product) {
    notFound();
  }

  const readOnly = isReadOnlyProductRole(context.currentRole);

  if (readOnly) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl">{product.name}</h1>
          <p className="text-muted-foreground">Read-only product view for analysts.</p>
        </div>
        <div className="w-48 overflow-hidden rounded-lg border border-border">
          <ProductImage path={product.product_image_path} alt={product.name} />
        </div>
      </div>
    );
  }

  if (!canManageProducts(context.currentRole)) {
    redirect("/dashboard/products");
  }

  const currentImageUrl = await getProductImagePublicUrl(product.product_image_path);

  return (
    <ProductForm
      mode="edit"
      productId={product.id}
      initialValues={{
        name: product.name,
        slug: product.slug,
        isActive: product.is_active,
      }}
      currentImagePath={product.product_image_path}
      currentImageUrl={currentImageUrl}
    />
  );
}
