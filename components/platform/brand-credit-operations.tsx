"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLATFORM_MAX_CREDIT_AMOUNT, PLATFORM_MAX_REASON_LENGTH } from "@/lib/platform/constants";

type OperationResult = {
  type: "success" | "error";
  message: string;
};

function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}

export function BrandCreditOperations({
  brandId,
  availableCredits,
  maxRevocableCredits,
}: {
  brandId: string;
  availableCredits: number;
  maxRevocableCredits: number;
}) {
  const router = useRouter();
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [revokeAmount, setRevokeAmount] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [grantPending, setGrantPending] = useState(false);
  const [revokePending, setRevokePending] = useState(false);
  const [grantResult, setGrantResult] = useState<OperationResult | null>(null);
  const [revokeResult, setRevokeResult] = useState<OperationResult | null>(null);

  const grantIdempotencyKey = useRef(createIdempotencyKey("platform-grant"));
  const revokeIdempotencyKey = useRef(createIdempotencyKey("platform-revoke"));

  const resetGrantIdempotency = useCallback(() => {
    grantIdempotencyKey.current = createIdempotencyKey("platform-grant");
  }, []);

  const resetRevokeIdempotency = useCallback(() => {
    revokeIdempotencyKey.current = createIdempotencyKey("platform-revoke");
  }, []);

  async function submitGrant(event: React.FormEvent) {
    event.preventDefault();
    setGrantResult(null);

    const amount = Number.parseInt(grantAmount, 10);

    if (!Number.isFinite(amount) || amount <= 0 || amount > PLATFORM_MAX_CREDIT_AMOUNT) {
      setGrantResult({ type: "error", message: "Enter a valid grant amount." });
      return;
    }

    const reason = grantReason.trim();

    if (!reason || reason.length > PLATFORM_MAX_REASON_LENGTH) {
      setGrantResult({ type: "error", message: "Enter a valid reason." });
      return;
    }

    setGrantPending(true);

    try {
      const response = await fetch("/api/platform/credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          amount,
          reason,
          idempotencyKey: grantIdempotencyKey.current,
        }),
      });

      const payload = (await response.json()) as { error?: string; wasCreated?: boolean };

      if (!response.ok) {
        setGrantResult({
          type: "error",
          message: payload.error ?? "Grant request failed.",
        });
        return;
      }

      setGrantResult({
        type: "success",
        message: payload.wasCreated === false ? "Grant replay acknowledged." : "Credits granted.",
      });
      resetGrantIdempotency();
      setGrantAmount("");
      setGrantReason("");
      router.refresh();
    } catch {
      setGrantResult({ type: "error", message: "Grant request failed." });
    } finally {
      setGrantPending(false);
    }
  }

  async function submitRevoke(event: React.FormEvent) {
    event.preventDefault();
    setRevokeResult(null);

    if (!revokeConfirmed) {
      setRevokeResult({ type: "error", message: "Confirm revoke before submitting." });
      return;
    }

    const amount = Number.parseInt(revokeAmount, 10);

    if (!Number.isFinite(amount) || amount <= 0 || amount > PLATFORM_MAX_CREDIT_AMOUNT) {
      setRevokeResult({ type: "error", message: "Enter a valid revoke amount." });
      return;
    }

    if (amount > maxRevocableCredits) {
      setRevokeResult({
        type: "error",
        message: "Revoke amount exceeds available credits.",
      });
      return;
    }

    const reason = revokeReason.trim();

    if (!reason || reason.length > PLATFORM_MAX_REASON_LENGTH) {
      setRevokeResult({ type: "error", message: "Enter a valid reason." });
      return;
    }

    setRevokePending(true);

    try {
      const response = await fetch("/api/platform/credits/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          amount,
          reason,
          idempotencyKey: revokeIdempotencyKey.current,
        }),
      });

      const payload = (await response.json()) as { error?: string; wasCreated?: boolean };

      if (!response.ok) {
        setRevokeResult({
          type: "error",
          message: payload.error ?? "Revoke request failed.",
        });
        return;
      }

      setRevokeResult({
        type: "success",
        message: payload.wasCreated === false ? "Revoke replay acknowledged." : "Credits revoked.",
      });
      resetRevokeIdempotency();
      setRevokeAmount("");
      setRevokeReason("");
      setRevokeConfirmed(false);
      router.refresh();
    } catch {
      setRevokeResult({ type: "error", message: "Revoke request failed." });
    } finally {
      setRevokePending(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={submitGrant} className="space-y-4 rounded-xl border border-border/80 bg-surface/80 p-6">
        <h2 className="font-heading text-xl text-foreground">Grant credits</h2>
        <div className="space-y-2">
          <Label htmlFor="grant-amount">Amount</Label>
          <Input
            id="grant-amount"
            inputMode="numeric"
            pattern="[0-9]*"
            value={grantAmount}
            onChange={(event) => setGrantAmount(event.target.value.replace(/\D/g, ""))}
            disabled={grantPending}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grant-reason">Reason</Label>
          <Input
            id="grant-reason"
            value={grantReason}
            onChange={(event) => setGrantReason(event.target.value)}
            maxLength={PLATFORM_MAX_REASON_LENGTH}
            disabled={grantPending}
            required
          />
        </div>
        {grantResult ? (
          <p
            className={
              grantResult.type === "success" ? "text-sm text-emerald-700" : "text-sm text-destructive"
            }
            role="status"
          >
            {grantResult.message}
          </p>
        ) : null}
        <Button type="submit" disabled={grantPending}>
          {grantPending ? "Granting…" : "Grant credits"}
        </Button>
      </form>

      <form onSubmit={submitRevoke} className="space-y-4 rounded-xl border border-border/80 bg-surface/80 p-6">
        <h2 className="font-heading text-xl text-foreground">Revoke credits</h2>
        <p className="text-sm text-muted-foreground">
          Available: {availableCredits} · Maximum revocable: {maxRevocableCredits}
        </p>
        <div className="space-y-2">
          <Label htmlFor="revoke-amount">Amount</Label>
          <Input
            id="revoke-amount"
            inputMode="numeric"
            pattern="[0-9]*"
            value={revokeAmount}
            onChange={(event) => setRevokeAmount(event.target.value.replace(/\D/g, ""))}
            disabled={revokePending}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="revoke-reason">Reason</Label>
          <Input
            id="revoke-reason"
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
            maxLength={PLATFORM_MAX_REASON_LENGTH}
            disabled={revokePending}
            required
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={revokeConfirmed}
            onChange={(event) => setRevokeConfirmed(event.target.checked)}
            disabled={revokePending}
          />
          I confirm this revoke operation
        </label>
        {revokeResult ? (
          <p
            className={
              revokeResult.type === "success" ? "text-sm text-emerald-700" : "text-sm text-destructive"
            }
            role="status"
          >
            {revokeResult.message}
          </p>
        ) : null}
        <Button type="submit" variant="destructive" disabled={revokePending}>
          {revokePending ? "Revoking…" : "Revoke credits"}
        </Button>
      </form>
    </div>
  );
}
