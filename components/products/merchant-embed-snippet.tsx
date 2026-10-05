import { CopyTryOnLinkButton } from "@/components/products/copy-try-on-link";
import { buildMerchantEmbedSnippet } from "@/lib/catalog/merchant-embed";
import { getSiteUrl } from "@/lib/env";

export function MerchantEmbedSnippet({
  brandSlug,
  productSlug,
  active,
}: {
  brandSlug: string;
  productSlug: string;
  active: boolean;
}) {
  if (!active) {
    return null;
  }

  const snippet = buildMerchantEmbedSnippet(getSiteUrl(), brandSlug, productSlug);

  if (!snippet) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Embed on your product page</p>
      <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 text-xs text-foreground">
        {snippet}
      </pre>
      <CopyTryOnLinkButton url={snippet} idleLabel="Copy snippet" />
    </div>
  );
}
