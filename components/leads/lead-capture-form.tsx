"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  assertExactResponseKeys,
  LEAD_GET_RESPONSE_KEYS,
  LEAD_POST_RESPONSE_KEYS,
} from "@/lib/leads/public-response";
import { readLeadFormDismissed, writeLeadFormDismissed } from "@/lib/leads/dismiss-storage";
import { parseLeadCaptureBody } from "@/lib/leads/validation";
import { trackAnalyticsEvent } from "@/lib/analytics/track";

type LeadStatusState = "loading" | "ready" | "submitted" | "unavailable" | "status-error";

type LeadCaptureFormProps = {
  sessionId: string;
  brandName: string;
};

function mapSubmitError(status: number, payload: { error?: string } | null): string {
  if (status === 409) {
    return "Details were already submitted for this try-on. We cannot change them here.";
  }

  if (status === 410) {
    return "This try-on session is no longer accepting contact details.";
  }

  if (status === 422) {
    return payload?.error ?? "Check the form fields and consent boxes, then try again.";
  }

  if (status === 429) {
    return "Too many attempts. Please wait a moment and try again.";
  }

  if (status === 401 || status === 404) {
    return "Contact details cannot be submitted for this try-on right now.";
  }

  return payload?.error ?? "Unable to submit your details right now. Please try again.";
}

export function LeadCaptureForm({ sessionId, brandName }: LeadCaptureFormProps) {
  const formId = useId();
  const statusAbortRef = useRef<AbortController | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const [dismissed, setDismissed] = useState(() => readLeadFormDismissed(sessionId));
  const [statusState, setStatusState] = useState<LeadStatusState>("loading");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consentToContact, setConsentToContact] = useState(false);
  const [consentToMarketing, setConsentToMarketing] = useState(false);
  const [website] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const leadFormViewedRef = useRef(false);

  useEffect(() => {
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;

    void (async () => {
      try {
        const response = await fetch(`/api/try-on/sessions/${sessionId}/lead`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

        if (controller.signal.aborted) {
          return;
        }

        if (response.status === 410) {
          setStatusState("unavailable");
          return;
        }

        if (!response.ok || !payload) {
          setStatusState("status-error");
          return;
        }

        assertExactResponseKeys(payload, LEAD_GET_RESPONSE_KEYS);

        if (payload.submitted === true) {
          setStatusState("submitted");
        } else {
          setStatusState("ready");
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatusState("status-error");
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [sessionId]);

  useEffect(() => {
    if (statusState === "ready" && !dismissed && !leadFormViewedRef.current) {
      leadFormViewedRef.current = true;
      trackAnalyticsEvent({
        event: "lead_form_viewed",
        surface: "lead",
        route_group: "/try",
        outcome: "viewed",
      });
    }
  }, [dismissed, statusState]);

  const handleDismiss = useCallback(() => {
    writeLeadFormDismissed(sessionId, true);
    setDismissed(true);
  }, [sessionId]);

  const handleReopen = useCallback(() => {
    writeLeadFormDismissed(sessionId, false);
    setDismissed(false);
  }, [sessionId]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (submitting || statusState === "submitted" || statusState === "unavailable") {
        return;
      }

      setClientError(null);
      setStatusMessage(null);

      const parsed = parseLeadCaptureBody({
        fullName,
        email,
        phone,
        consentToContact,
        consentToMarketing,
        idempotencyKey: idempotencyKeyRef.current,
        website,
      });

      if (!parsed.success) {
        setClientError(parsed.error);
        return;
      }

      setSubmitting(true);

      try {
        const response = await fetch(`/api/try-on/sessions/${sessionId}/lead`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            fullName: parsed.data.normalizedFullName ?? undefined,
            email: parsed.data.normalizedEmail,
            phone: parsed.data.normalizedPhone ?? undefined,
            consentToContact: true,
            consentToMarketing: parsed.data.consentToMarketing,
            idempotencyKey: parsed.data.idempotencyKey,
            website: "",
          }),
        });

        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

        if (response.status === 201 || response.status === 200) {
          if (payload) {
            assertExactResponseKeys(payload, LEAD_POST_RESPONSE_KEYS);
          }

          trackAnalyticsEvent({
            event: "lead_submitted",
            surface: "lead",
            route_group: "/try",
            outcome: "submitted",
          });

          setStatusState("submitted");
          setStatusMessage("Thank you. The merchant may contact you about this try-on.");
          setFullName("");
          setEmail("");
          setPhone("");
          setConsentToContact(false);
          setConsentToMarketing(false);
          idempotencyKeyRef.current = crypto.randomUUID();
          return;
        }

        if (response.status === 409) {
          setStatusState("submitted");
          setStatusMessage(mapSubmitError(response.status, payload));
          return;
        }

        if (response.status === 410) {
          setStatusState("unavailable");
          setClientError(mapSubmitError(response.status, payload));
          return;
        }

        setClientError(mapSubmitError(response.status, payload));
      } catch {
        setClientError("Unable to submit your details right now. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      consentToContact,
      consentToMarketing,
      email,
      fullName,
      phone,
      sessionId,
      statusState,
      submitting,
      website,
    ],
  );

  if (statusState === "loading") {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Checking optional contact form…
      </p>
    );
  }

  if (statusState === "unavailable") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Contact details are no longer being collected for this try-on.
      </p>
    );
  }

  if (statusState === "submitted") {
    return (
      <div className="space-y-2" role="status" aria-live="polite">
        <p className="font-medium text-foreground">Details received</p>
        <p className="text-sm text-muted-foreground">
          {statusMessage ??
            `Thank you. ${brandName} may contact you about this try-on if needed.`}
        </p>
      </div>
    );
  }

  if (dismissed) {
    return (
      <button
        type="button"
        className="btn btn-secondary text-sm"
        onClick={handleReopen}
      >
        Share details with {brandName}
      </button>
    );
  }

  const emailErrorId = `${formId}-email-error`;
  const formErrorId = `${formId}-form-error`;

  return (
    <div
      className="space-y-4 rounded-xl border border-border/70 bg-surface/60 p-4 md:p-6"
      data-ph-no-capture
      ph-no-capture="true"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h3 className="font-heading text-xl text-foreground">Share your details with {brandName}</h3>
          <p className="text-sm text-muted-foreground">
            Optional: if you would like {brandName} to follow up about this product or your try-on,
            leave your contact details below. You can skip this and keep viewing your result.
          </p>
        </div>
        <button type="button" className="text-sm text-muted-foreground underline" onClick={handleDismiss}>
          Dismiss
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Submitted details are shared with {brandName}. Final privacy wording requires legal review.
      </p>

      {statusState === "status-error" ? (
        <p className="text-sm text-muted-foreground">
          We could not verify whether details were already submitted. You may still try submitting
          below.
        </p>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${formId}-full-name`}>
            Full name <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id={`${formId}-full-name`}
            name="fullName"
            type="text"
            autoComplete="name"
            maxLength={120}
            value={fullName}
            disabled={submitting}
            onChange={(event) => setFullName(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${formId}-email`}>
            Email <span className="text-destructive">*</span>
          </label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            disabled={submitting}
            aria-describedby={clientError ? emailErrorId : undefined}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${formId}-phone`}>
            Phone <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id={`${formId}-phone`}
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={32}
            value={phone}
            disabled={submitting}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">Include country code if outside your local region.</p>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consentToContact}
            disabled={submitting}
            onChange={(event) => setConsentToContact(event.target.checked)}
            className="mt-1"
            required
          />
          <span>
            I agree that {brandName} may contact me about this try-on and related product enquiry.
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={consentToMarketing}
            disabled={submitting}
            onChange={(event) => setConsentToMarketing(event.target.checked)}
            className="mt-1"
          />
          <span>
            I would like to receive promotional or marketing communication from {brandName}. (Optional)
          </span>
        </label>

        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          readOnly
          className="hidden"
          aria-hidden="true"
        />

        {clientError ? (
          <p id={formErrorId} className="text-sm text-destructive" role="alert">
            {clientError}
          </p>
        ) : null}

        <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {statusMessage}
        </div>

        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={submitting}>
          {submitting ? "Submitting…" : "Send details to merchant"}
        </button>
      </form>
    </div>
  );
}
