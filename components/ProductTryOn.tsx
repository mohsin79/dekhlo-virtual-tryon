"use client";

import { useCallback, useRef, useState } from "react";
import { Uploader } from "@/components/Uploader";
import {
  shouldMintNewClientRequestId,
  shouldResetAttemptOnPhotoChange,
  type ProductTryOnPhase,
} from "@/lib/try-on/sessions/session-upload-eligibility";
import type { Database } from "@/lib/supabase/database.types";

type TryOnSessionStatus = Database["public"]["Enums"]["try_on_session_status"];

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

      setPersonFile(file);
    },
    [phase, resetAttemptState],
  );

  const canStart =
    !!personFile &&
    phase !== "creating" &&
    phase !== "uploading" &&
    phase !== "validating" &&
    phase !== "generating";

  async function startTryOn() {
    if (!personFile) {
      return;
    }

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

      setPhase("uploading");

      const uploadResponse = await fetch(createPayload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": personFile.type,
        },
        body: personFile,
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

      if (!validateResponse.ok) {
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

      setPhase("generating");

      const generateResponse = await fetch(
        `/api/try-on/sessions/${createPayload.sessionId}/generate`,
        { method: "POST" },
      );
      const generatePayload = await generateResponse.json().catch(() => null);

      if (!generateResponse.ok) {
        attemptRef.current = {
          ...attemptRef.current,
          sessionStatus: generatePayload?.status ?? "failed",
        };
        throw new Error(generatePayload?.error ?? "Try-on generation failed.");
      }

      if (!generatePayload.resultUrl) {
        throw new Error("Try-on completed without a result.");
      }

      attemptRef.current = {
        ...attemptRef.current,
        sessionStatus: generatePayload?.status ?? "completed",
      };
      setResultUrl(generatePayload.resultUrl);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function handleTryAnother() {
    resetAttemptState();
  }

  const busy =
    phase === "creating" ||
    phase === "uploading" ||
    phase === "validating" ||
    phase === "generating";

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
              {phase === "uploading" && "Uploading your photo…"}
              {phase === "validating" && "Validating upload and reserving credits…"}
              {phase === "generating" && "Generating your try-on…"}
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
