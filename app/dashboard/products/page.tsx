import Link from "next/link";
import { DeleteProductButton } from "@/components/products/delete-product-button";
import { ProductImage } from "@/components/products/product-image";
import { ToggleProductActiveButton } from "@/components/products/toggle-product-active-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserContext } from "@/lib/auth/get-user-context";
import { canManageProducts } from "@/lib/products/permissions";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function ProductsPage() {
  const context = await requireUserContext("/dashboard/products");

  if (!context.currentBrand) {
    return null;
  }

  const supabase = await createClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, slug, product_image_path, is_active, created_at, updated_at")
    .eq("brand_id", context.currentBrand.brandId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  const canManage = canManageProducts(context.currentRole);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-heading text-3xl text-foreground">Products</h1>
          <p className="max-w-2xl text-muted-foreground">
            Manage catalog items for {context.currentBrand.brand.name}. Images are stored in the
            public product-images bucket.
          </p>
        </div>
        {canManage ? (
          <Link href="/dashboard/products/new" className="inline-flex">
            <Button type="button">Create product</Button>
          </Link>
        ) : null}
      </section>

      {(products ?? []).length === 0 ? (
        <Card className="border-border/80 bg-surface/80">
          <CardHeader>
            <CardTitle className="font-heading text-xl">No products yet</CardTitle>
            <CardDescription>
              {canManage
                ? "Create your first product to start building your catalog."
                : "No products have been added to this brand yet."}
            </CardDescription>
          </CardHeader>
          {canManage ? (
            <CardContent>
              <Link href="/dashboard/products/new" className="inline-flex">
                <Button type="button">Create product</Button>
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <div className="grid gap-4">
          {(products ?? []).map((product) => (
            <Card key={product.id} className="border-border/80 bg-surface/80">
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border">
                  <ProductImage
                    path={product.product_image_path}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm text-muted-foreground">/{product.slug}</p>
                  <p className="text-sm text-muted-foreground">
                    {product.is_active ? "Active" : "Inactive"} · Updated {formatDate(product.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/products/${product.id}/edit`} className="inline-flex">
                    <Button type="button" variant="outline" size="sm">
                      Edit
                    </Button>
                  </Link>
                  {canManage ? (
                    <>
                      <ToggleProductActiveButton productId={product.id} isActive={product.is_active} />
                      <DeleteProductButton productId={product.id} productName={product.name} />
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
