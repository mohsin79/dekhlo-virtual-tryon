import { isEmbeddableTryOnPath } from "@/lib/embed/paths";

export type FramingHeader = {
  key: string;
  value: string;
};

/**
 * Framing policy that belongs with the merchant embed.
 *
 * The embed document is meant to be placed on a store product page, so it sends
 * an enforcing `frame-ancestors *` and no `X-Frame-Options` (that header cannot
 * express an allow). Every other route denies framing so the dashboard, auth,
 * and the standalone try-on page are not clickjackable.
 *
 * This is a separate enforcing CSP from the Report-Only policy. It sets only
 * `frame-ancestors`, so it does not enforce script, image, or connect rules.
 */
export function framingHeadersForPath(pathname: string): FramingHeader[] {
  if (isEmbeddableTryOnPath(pathname)) {
    return [{ key: "Content-Security-Policy", value: "frame-ancestors *" }];
  }

  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  ];
}
