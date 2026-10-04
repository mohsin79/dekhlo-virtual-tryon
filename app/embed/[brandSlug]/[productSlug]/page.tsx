import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductTryOn } from "@/components/ProductTryOn";
import { getPublicProductBySlugs } from "@/lib/catalog/get-public-product";
import { getProductImagePublicUrl } from "@/lib/products/public-url";

type PageProps = {
  params: Promise<{ brandSlug: string; productSlug: string }>;
};

export const metadata: Metadata = {
  title: "Virtual try-on",
  robots: { index: false, follow: false },
};

export default async function EmbedTryOnProductPage({ params }: PageProps) {
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
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-6 space-y-1">
        <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">{product.brandName}</p>
        <h1 className="font-heading text-3xl text-foreground">{product.productName}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Upload your photo to preview how this piece might look on you. No account required.
        </p>
      </header>

      <ProductTryOn
        variant="embed"
        brandSlug={product.brandSlug}
        productSlug={product.productSlug}
        productName={product.productName}
        brandName={product.brandName}
        productImageUrl={productImageUrl}
      />
    </div>
  );
}
