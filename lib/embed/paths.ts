const EMBED_SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * The only document merchants may frame. Two catalog slugs, nothing else.
 * `/embed/preview` and `/embed/loader` stay outside this shape on purpose.
 */
const EMBEDDABLE_TRY_ON_PATH = new RegExp(`^/embed/${EMBED_SLUG}/${EMBED_SLUG}/?$`);

export function isEmbeddableTryOnPath(pathname: string): boolean {
  return EMBEDDABLE_TRY_ON_PATH.test(pathname);
}
