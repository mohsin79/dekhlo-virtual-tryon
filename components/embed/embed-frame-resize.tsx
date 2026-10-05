"use client";

import { useEffect } from "react";
import { clampEmbedFrameHeight, EMBED_RESIZE_MESSAGE_TYPE } from "@/lib/embed/resize";

/**
 * Tells the host page how tall the embed document is. The payload is only a
 * type and a height. The host origin is unknown, so the target is "*"; the
 * host must still check event.origin and event.source.
 */
export function EmbedFrameResize() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.style.overflowX = "clip";
    root.style.maxWidth = "100%";

    if (body) {
      body.style.overflowX = "clip";
      body.style.maxWidth = "100%";
    }

    const content = document.querySelector("[data-embed-frame-root]");

    if (window.parent === window || !(content instanceof HTMLElement)) {
      return () => {
        root.style.overflowX = "";
        root.style.maxWidth = "";

        if (body) {
          body.style.overflowX = "";
          body.style.maxWidth = "";
        }
      };
    }

    let lastHeight = 0;

    const postHeight = () => {
      // Measure the content box. The iframe viewport grows with the posted height,
      // so the document height would keep climbing if we measured the viewport.
      const height = clampEmbedFrameHeight(content.getBoundingClientRect().height);

      if (height == null || height === lastHeight) {
        return;
      }

      lastHeight = height;
      window.parent.postMessage({ type: EMBED_RESIZE_MESSAGE_TYPE, height }, "*");
    };

    postHeight();

    const observer = new ResizeObserver(() => {
      postHeight();
    });

    observer.observe(content);

    window.addEventListener("load", postHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", postHeight);
      root.style.overflowX = "";
      root.style.maxWidth = "";

      if (body) {
        body.style.overflowX = "";
        body.style.maxWidth = "";
      }
    };
  }, []);

  return null;
}
