import { getProductImagePublicUrl } from "@/lib/products/public-url";

export async function ProductImage({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const src = await getProductImagePublicUrl(path);

  if (!src) {
    return (
      <div
        className={className ?? "flex aspect-square items-center justify-center bg-muted text-xs text-muted-foreground"}
        aria-hidden
      >
        No image
      </div>
    );
  }

  return (
    // Product catalog previews use native img; Next.js image optimizer remains disabled project-wide.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className ?? "aspect-square w-full object-cover"} />
  );
}
