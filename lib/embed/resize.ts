/** Height-only message. Never carries a token, photo, or result URL. */
export const EMBED_RESIZE_MESSAGE_TYPE = "dekhlo:embed-resize";

export const EMBED_RESIZE_MIN_HEIGHT = 640;
export const EMBED_RESIZE_MAX_HEIGHT = 8000;

const RESIZE_MESSAGE_KEYS = ["height", "type"] as const;

export function clampEmbedFrameHeight(height: number): number | null {
  if (!Number.isFinite(height)) {
    return null;
  }

  const rounded = Math.ceil(height);

  if (rounded < EMBED_RESIZE_MIN_HEIGHT) {
    return EMBED_RESIZE_MIN_HEIGHT;
  }

  if (rounded > EMBED_RESIZE_MAX_HEIGHT) {
    return EMBED_RESIZE_MAX_HEIGHT;
  }

  return rounded;
}

/**
 * Accepts only `{ type, height }`. Any other field is rejected so a message
 * cannot smuggle a session token or image URL into the host page.
 */
export function readEmbedResizeHeight(data: unknown): number | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const keys = Object.keys(record).sort();

  if (keys.length !== RESIZE_MESSAGE_KEYS.length || keys.some((key, index) => key !== RESIZE_MESSAGE_KEYS[index])) {
    return null;
  }

  if (record.type !== EMBED_RESIZE_MESSAGE_TYPE || typeof record.height !== "number") {
    return null;
  }

  return clampEmbedFrameHeight(record.height);
}

/**
 * Where the embed document should scroll so the result heading stays visible.
 * A frame that already fits the document stays at the top. A short frame
 * scrolls the heading down from the top edge by `scrollMargin` pixels.
 */
export function embedResultScrollTop(input: {
  documentHeight: number;
  frameHeight: number;
  resultTop: number;
  scrollMargin?: number;
}): number {
  const margin = input.scrollMargin ?? 16;

  if (input.documentHeight <= input.frameHeight + 8) {
    return 0;
  }

  const maxScroll = Math.max(0, input.documentHeight - input.frameHeight);
  const target = Math.max(0, input.resultTop - margin);

  return Math.min(maxScroll, target);
}
