import type { Metadata } from "next";
import { EmbedHostFrame } from "@/components/embed/embed-host-frame";
import { buildMerchantEmbedSnippet, parseEmbedPreviewSlugs } from "@/lib/catalog/merchant-embed";
import { getSiteUrl } from "@/lib/env";

export const metadata: Metadata = {
  title: "Embed preview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ brand?: string; product?: string }>;
};

export default async function EmbedPreviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const slugs = parseEmbedPreviewSlugs({ brand: params.brand, product: params.product });
  const siteUrl = getSiteUrl();
  const snippet = slugs ? buildMerchantEmbedSnippet(siteUrl, slugs.brandSlug, slugs.productSlug) : null;
  const example = `${siteUrl}/embed/preview?brand=dekhlo-test-brand&product=test-black-t-shirt`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid w-full min-w-0 max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="min-w-0 space-y-4">
          <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Sample store</p>
          <h1 className="font-heading text-4xl">Black T-shirt</h1>
          <p className="max-w-xl text-muted-foreground">
            This page stands in for a merchant product page. The try-on on the right is the same embed a
            store pastes into its own site. Shopper photos, session tokens, credits, and generation stay
            inside the frame.
          </p>
          <p className="text-sm text-muted-foreground">
            Open it with your catalog slugs. For the staging test product:
          </p>
          <p className="break-all rounded-md border border-border bg-surface/80 p-3 text-sm">{example}</p>
          {snippet ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Snippet for this product</p>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface/80 p-3 text-xs">
                {snippet}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-destructive">
              Add <code>brand</code> and <code>product</code> query params using the same slugs as the public
              try-on link.
            </p>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          <h2 className="font-heading text-2xl">Try it on</h2>
          {slugs && snippet ? (
            <EmbedHostFrame src={`/embed/${slugs.brandSlug}/${slugs.productSlug}`} title="Virtual try-on" />
          ) : (
            <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              Embed preview appears here once both slugs are valid.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
