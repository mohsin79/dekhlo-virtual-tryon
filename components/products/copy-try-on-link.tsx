"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyTryOnLinkButton({ url }: { url: string }) {
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
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
