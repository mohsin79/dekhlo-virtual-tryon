/**
 * Early rejection guard for oversized request bodies.
 *
 * Content-Length is advisory only: a request that omits the header (for example
 * chunked transfer encoding) still reaches the body parser, so this is NOT a
 * complete streaming bound. Callers must keep their schema validation and any
 * per-file size checks in place.
 *
 * Semantics match the Phase 8B lead and Phase 8A platform handlers: a missing or
 * unparseable header falls through to the normal parsing path, and a body exactly
 * at the limit is allowed.
 */
export function exceedsContentLengthLimit(
  contentLength: string | null,
  maxBytes: number,
): boolean {
  if (!contentLength) {
    return false;
  }

  const length = Number.parseInt(contentLength, 10);

  return Number.isFinite(length) && length > maxBytes;
}
