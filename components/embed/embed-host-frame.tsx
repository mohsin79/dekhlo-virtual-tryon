"use client";

import { useEffect, useRef } from "react";
import { EMBED_IFRAME_HEIGHT } from "@/lib/catalog/merchant-embed";
import { readEmbedResizeHeight } from "@/lib/embed/resize";

export function EmbedHostFrame({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;

      if (!frame || event.source !== frame.contentWindow) {
        return;
      }

      let expectedOrigin: string;

      try {
        expectedOrigin = new URL(frame.src, window.location.origin).origin;
      } catch {
        return;
      }

      if (event.origin !== expectedOrigin) {
        return;
      }

      const height = readEmbedResizeHeight(event.data);

      if (height == null) {
        return;
      }

      frame.style.height = `${height}px`;
    };

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [src]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title={title}
      className="block w-full max-w-full"
      height={EMBED_IFRAME_HEIGHT}
      style={{ border: 0, height: EMBED_IFRAME_HEIGHT, width: "100%", maxWidth: "100%" }}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
