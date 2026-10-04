"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyTryOnLinkButton({
  url,
  idleLabel = "Copy link",
  copiedLabel = "Copied",
}: {
  url: string;
  idleLabel?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? copiedLabel : idleLabel}
    </Button>
  );
}
