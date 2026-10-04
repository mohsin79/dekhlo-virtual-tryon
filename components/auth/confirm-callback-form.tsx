"use client";

import { useFormStatus } from "react-dom";
import { completeAuthCallbackAction } from "@/app/auth/confirm/actions";
import { Button } from "@/components/ui/button";

function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Continuing..." : label}
    </Button>
  );
}

export function ConfirmCallbackForm({
  tokenHash,
  type,
  code,
  nextPath,
  buttonLabel,
}: {
  tokenHash: string;
  type: string;
  code: string;
  nextPath: string;
  buttonLabel: string;
}) {
  return (
    <form action={completeAuthCallbackAction} className="space-y-4">
      <input type="hidden" name="tokenHash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="next" value={nextPath} />
      <ConfirmButton label={buttonLabel} />
    </form>
  );
}
