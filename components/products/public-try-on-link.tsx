import { CopyTryOnLinkButton } from "@/components/products/copy-try-on-link";
import { buildPublicTryOnPath, buildPublicTryOnUrl } from "@/lib/catalog/public-try-on-url";
import { getSiteUrl } from "@/lib/env";

export function PublicTryOnLink({
  brandSlug,
  productSlug,
  active,
}: {
  brandSlug: string;
  productSlug: string;
  active: boolean;
}) {
  if (!active) {
    return (
      <p className="text-sm text-muted-foreground">
        Inactive products stay in your catalog and are hidden from shoppers.
      </p>
    );
  }

  const path = buildPublicTryOnPath(brandSlug, productSlug);
  const url = buildPublicTryOnUrl(getSiteUrl(), brandSlug, productSlug);

  if (!path || !url) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Public try-on link</p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          className="break-all text-sm text-accent-700 underline"
        >
          {url}
        </a>
        <CopyTryOnLinkButton url={url} />
      </div>
    </div>
  );
}
