import { notFound } from "next/navigation";
import { ProductTryOn } from "@/components/ProductTryOn";
import { getPublicProductBySlugs } from "@/lib/catalog/get-public-product";
import { getProductImagePublicUrl } from "@/lib/products/public-url";

type PageProps = {
  params: Promise<{ brandSlug: string; productSlug: string }>;
};

export default async function TryOnProductPage({ params }: PageProps) {
  const { brandSlug, productSlug } = await params;
  const product = await getPublicProductBySlugs(brandSlug, productSlug);

  if (!product) {
    notFound();
  }

  const productImageUrl = await getProductImagePublicUrl(product.productImagePath);

  if (!productImageUrl) {
    notFound();
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">{product.brandName}</p>
        <h1 className="font-heading text-4xl text-foreground">Virtual try-on</h1>
        <p className="max-w-2xl text-muted-foreground">
          Upload your photo to preview how {product.productName} might look on you. No account required.
        </p>
      </header>

      <ProductTryOn
        brandSlug={product.brandSlug}
        productSlug={product.productSlug}
        productName={product.productName}
        productImageUrl={productImageUrl}
      />
    </div>
  );
}
