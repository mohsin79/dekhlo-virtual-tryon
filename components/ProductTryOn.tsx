"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Uploader } from "@/components/Uploader";
import {
  shouldMintNewClientRequestId,
  shouldResetAttemptOnPhotoChange,
  type ProductTryOnPhase,
} from "@/lib/try-on/sessions/session-upload-eligibility";
import {
  preparePersonPhotoForUpload,
  validatePersonPhotoFileSize,
  validatePersonPhotoMimeType,
} from "@/lib/try-on/sessions/person-photo-resize";
import {
  computeSessionPollDelayMs,
  shouldContinueSessionPolling,
} from "@/lib/try-on/sessions/session-polling";
import type { Database } from "@/lib/supabase/database.types";

type TryOnSessionStatus = Database["public"]["Enums"]["try_on_session_status"];

type SessionPollPayload = {
  status?: TryOnSessionStatus;
  resultUrl?: string | null;
  sanitizedErrorMessage?: string | null;
  error?: string;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSessionUntilTerminal(
  sessionId: string,
  isCancelled: () => boolean,
): Promise<SessionPollPayload> {
  let attempt = 0;

  while (!isCancelled()) {
    const response = await fetch(`/api/try-on/sessions/${sessionId}`, {
      method: "GET",
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as SessionPollPayload | null;

    if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
      throw new Error(payload?.error ?? "This session is no longer available.");
    }

    if (!response.ok && response.status !== 503) {
      throw new Error(payload?.error ?? "Unable to check try-on status.");
    }

    const status = payload?.status;

    if (status === "completed") {
      if (!payload?.resultUrl) {
        throw new Error("Try-on completed without a result.");
      }

      return payload;
    }

    if (status === "failed" || status === "cancelled") {
      throw new Error(payload?.sanitizedErrorMessage ?? payload?.error ?? "Try-on generation failed.");
    }

    if (status && !shouldContinueSessionPolling(status)) {
      throw new Error("Try-on is in an unexpected state.");
    }

    await sleep(computeSessionPollDelayMs(attempt));
    attempt += 1;
  }

  throw new Error("Try-on polling was cancelled.");
}

type ProductTryOnProps = {
  brandSlug: string;
  productSlug: string;
  productName: string;
  productImageUrl: string;
};

type AttemptState = {
  clientRequestId: string;
  sessionId: string | null;
  sessionStatus: TryOnSessionStatus | null;
};

function createAttemptState(): AttemptState {
  return {
    clientRequestId: crypto.randomUUID(),
    sessionId: null,
    sessionStatus: null,
  };
}

export function ProductTryOn({
  brandSlug,
  productSlug,
  productName,
  productImageUrl,
}: ProductTryOnProps) {
  const attemptRef = useRef<AttemptState>(createAttemptState());
  const pollAbortRef = useRef(false);
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [consentToStore, setConsentToStore] = useState(false);
  const [phase, setPhase] = useState<ProductTryOnPhase>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetAttemptState = useCallback(() => {
    attemptRef.current = createAttemptState();
    setResultUrl(null);
    setError(null);
    setPhase("idle");
  }, []);

  useEffect(() => {
    return () => {
      pollAbortRef.current = true;
    };
  }, []);

  const handlePersonFileChange = useCallback(
    (file: File | null) => {
      if (
        shouldResetAttemptOnPhotoChange({
          phase,
          sessionStatus: attemptRef.current.sessionStatus,
        })
      ) {
        resetAttemptState();
      }

      if (!file) {
        setPersonFile(null);
        setError(null);
        return;
      }

      const mimeError = validatePersonPhotoMimeType(file.type);
      if (mimeError) {
        setPersonFile(null);
        setError(mimeError.message);
        return;
      }

      const sizeError = validatePersonPhotoFileSize(file);
      if (sizeError) {
        setPersonFile(null);
        setError(sizeError.message);
        return;
      }

      setError(null);
      setPersonFile(file);
    },
    [phase, resetAttemptState],
  );

  const canStart =
    !!personFile &&
    phase !== "creating" &&
    phase !== "optimizing" &&
    phase !== "uploading" &&
    phase !== "validating" &&
    phase !== "polling";

  async function startTryOn() {
    if (!personFile) {
      return;
    }

    pollAbortRef.current = false;

    if (
      shouldMintNewClientRequestId({
        phase,
        sessionStatus: attemptRef.current.sessionStatus,
      })
    ) {
      resetAttemptState();
    }

    const { clientRequestId } = attemptRef.current;

    setPhase("creating");
    setError(null);
    setResultUrl(null);

    try {
      const createResponse = await fetch("/api/try-on/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandSlug,
          productSlug,
          clientRequestId,
          consentToStore,
        }),
      });

      const createPayload = await createResponse.json().catch(() => null);

      if (!createResponse.ok) {
        throw new Error(createPayload?.error ?? "Unable to start try-on.");
      }

      attemptRef.current = {
        ...attemptRef.current,
        sessionId: createPayload.sessionId,
        sessionStatus: createPayload.status ?? "pending_upload",
      };

      setPhase("optimizing");

      const prepared = await preparePersonPhotoForUpload(personFile);

      if (!prepared.ok) {
        throw new Error(prepared.error.message);
      }

      setPhase("uploading");

      const uploadResponse = await fetch(createPayload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": prepared.value.mimeType,
        },
        body: prepared.value.file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Photo upload failed.");
      }

      setPhase("validating");

      const validateResponse = await fetch(
        `/api/try-on/sessions/${createPayload.sessionId}/validate-upload`,
        { method: "POST" },
      );
      const validatePayload = await validateResponse.json().catch(() => null);

      if (validateResponse.status === 402) {
        attemptRef.current = {
          ...attemptRef.current,
          sessionStatus: "failed",
        };
        throw new Error(
          validatePayload?.sanitizedErrorMessage ??
            "This brand does not have enough credits for try-on right now.",
        );
      }

      if (validateResponse.status !== 202 && !validateResponse.ok) {
        attemptRef.current = {
          ...attemptRef.current,
          sessionStatus: validatePayload?.status ?? "failed",
        };
        throw new Error(validatePayload?.error ?? "Upload validation failed.");
      }

      attemptRef.current = {
        ...attemptRef.current,
        sessionStatus: validatePayload?.status ?? "queued",
      };

      setPhase("polling");

      const pollPayload = await pollSessionUntilTerminal(
        createPayload.sessionId,
        () => pollAbortRef.current,
      );

      attemptRef.current = {
        ...attemptRef.current,
        sessionStatus: pollPayload.status ?? "completed",
      };
      setResultUrl(pollPayload.resultUrl ?? null);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function handleTryAnother() {
    pollAbortRef.current = true;
    resetAttemptState();
  }

  const busy =
    phase === "creating" ||
    phase === "optimizing" ||
    phase === "uploading" ||
    phase === "validating" ||
    phase === "polling";

  return (
    <div className="space-y-8">
      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Selected product</p>
          <h2 className="font-heading text-2xl text-foreground">{productName}</h2>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productImageUrl}
              alt={productName}
              className="aspect-[3/4] w-full object-cover"
            />
          </div>
        </div>

        <div className="space-y-4">
          <Uploader
            id="person"
            index="01"
            indexColor="var(--color-accent)"
            title="Your photo"
            hint="Full-length, front-facing, well-lit."
            placeholder="Drop your photo, or click to browse"
            borderColor="var(--color-accent-400)"
            accept="image/jpeg,image/png,image/webp"
            washed
            onChange={handlePersonFileChange}
          />

          <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-surface/60 p-4 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={consentToStore}
              onChange={(event) => setConsentToStore(event.target.checked)}
              className="mt-1"
            />
            <span>
              Optional: allow Dekhlo to store this try-on result for up to 30 days to improve support and
              troubleshooting. Without consent, results are deleted within 24 hours.
            </span>
          </label>

          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={!canStart}
            onClick={startTryOn}
          >
            {busy ? "Working on your try-on…" : phase === "done" ? "Try another photo" : "Try this product on"}
          </button>

          {phase === "error" && error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Only your person photo is uploaded here. The garment comes from the merchant&apos;s catalog.
            Credit purchases and async processing will arrive in later phases.
          </p>
        </div>
      </section>

      {(busy || phase === "done") && (
        <section className="rounded-xl border border-border/70 bg-surface/80 p-6">
          {busy ? (
            <p className="text-muted-foreground">
              {phase === "creating" && "Creating secure session…"}
              {phase === "optimizing" && "Optimizing your photo…"}
              {phase === "uploading" && "Uploading your photo…"}
              {phase === "validating" && "Validating upload and reserving credits…"}
              {phase === "polling" && "Generating your try-on…"}
            </p>
          ) : null}

          {phase === "done" && resultUrl ? (
            <div className="space-y-4">
              <h3 className="font-heading text-xl">Your try-on result</h3>
              <div className="overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resultUrl} alt="Try-on result" className="w-full max-w-md object-cover" />
              </div>
              <div className="flex flex-wrap gap-3">
                <a className="btn btn-secondary inline-flex" href={resultUrl} download="dekhlo-try-on.png">
                  Download result
                </a>
                <button type="button" className="btn btn-secondary" onClick={handleTryAnother}>
                  Try another photo
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
