import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { TRY_ON_GENERATION_REQUESTED } from "@/lib/inngest/events";
import { captureUnexpectedError } from "@/lib/observability/sentry";
import {
  claimProcessingForWorker,
  compensateFailedGeneration,
  consumeCreditsForWorker,
  downloadPersonPhotoForWorker,
  downloadProductImageForWorker,
  generateTryOnResultForWorker,
  loadSessionForWorker,
  persistResultPathForWorker,
  recordProviderRequestId,
  TryOnWorkerPermanentError,
  uploadResultForWorker,
} from "@/lib/try-on/worker/generation-steps";

const GENERATION_RETRIES = 3;

function extractSessionIdFromFailureEvent(event: { data?: unknown }): string | null {
  const data = event.data;

  if (typeof data === "object" && data !== null) {
    if ("sessionId" in data && typeof (data as { sessionId?: unknown }).sessionId === "string") {
      return (data as { sessionId: string }).sessionId;
    }

    if ("event" in data) {
      const nested = (data as { event?: { data?: { sessionId?: unknown } } }).event?.data?.sessionId;
      if (typeof nested === "string") {
        return nested;
      }
    }
  }

  return null;
}

async function handlePermanentWorkerError(sessionId: string, err: TryOnWorkerPermanentError) {
  await compensateFailedGeneration({
    sessionId,
    errorCode: err.errorCode,
    sanitizedErrorMessage: err.sanitizedMessage,
  });
}

export const processTryOnGeneration = inngest.createFunction(
  {
    id: "process-try-on-generation",
    triggers: [{ event: TRY_ON_GENERATION_REQUESTED }],
    retries: GENERATION_RETRIES,
    concurrency: [
      { limit: 1, key: "event.data.sessionId" },
      { limit: 8 },
    ],
    onFailure: async ({ event, step, error }) => {
      await step.run("release-after-final-failure", async () => {
        const sessionId = extractSessionIdFromFailureEvent(event);

        if (!sessionId) {
          return;
        }

        await compensateFailedGeneration({
          sessionId,
          errorCode: "GENERATION_FAILED",
          sanitizedErrorMessage: "Try-on generation failed. Please try again.",
        });
      });

      captureUnexpectedError(error, {
        routeCategory: "inngest_worker",
        operation: "process_try_on_generation",
        errorCategory: "generation_exhausted",
        inngestFunctionId: "process-try-on-generation",
      });
    },
  },
  async ({ event, step, runId }) => {
    const sessionId = event.data.sessionId;

    const loaded = await step.run("load-and-validate-session", async () => loadSessionForWorker(sessionId));

    if (loaded.action === "skip") {
      return { skipped: true, reason: loaded.reason };
    }

    const claimed = await step.run("claim-processing-state", async () =>
      claimProcessingForWorker(sessionId, runId),
    );

    if (!claimed) {
      const latest = await loadSessionForWorker(sessionId);
      if (latest.action === "skip" && latest.reason === "completed") {
        return { skipped: true, reason: "completed" };
      }

      throw new NonRetriableError("Session is not eligible for processing.");
    }

    const personBuffer = await step.run("download-person-photo", async () => {
      try {
        return (await downloadPersonPhotoForWorker(loaded.session)).toString("base64");
      } catch (err) {
        if (err instanceof TryOnWorkerPermanentError) {
          await handlePermanentWorkerError(sessionId, err);
          throw new NonRetriableError(err.message);
        }

        throw err;
      }
    });

    const productPayload = await step.run("obtain-product-image", async () => {
      try {
        const buffer = await downloadProductImageForWorker(loaded.session);
        return { base64: buffer.toString("base64"), mimeType: "image/jpeg" };
      } catch (err) {
        if (err instanceof TryOnWorkerPermanentError) {
          await handlePermanentWorkerError(sessionId, err);
          throw new NonRetriableError(err.message);
        }

        throw err;
      }
    });

    const generation = await step.run("generate-try-on-result", async () =>
      generateTryOnResultForWorker({
        personBuffer: Buffer.from(personBuffer, "base64"),
        itemBuffer: Buffer.from(productPayload.base64, "base64"),
        itemMimeType: productPayload.mimeType,
      }),
    );

    if (generation.providerRequestId) {
      await step.run("record-provider-request-id", async () =>
        recordProviderRequestId(sessionId, generation.providerRequestId ?? null),
      );
    }

    const resultPath = await step.run("upload-result", async () =>
      uploadResultForWorker({
        session: loaded.session,
        imageBase64: generation.imageBase64,
      }),
    );

    await step.run("persist-result-path", async () => persistResultPathForWorker(sessionId, resultPath));

    await step.run("consume-reserved-credit", async () => consumeCreditsForWorker(sessionId));

    await step.run("finalize-session", async () => ({ sessionId, status: "completed" as const }));

    return { sessionId, status: "completed" as const };
  },
);

export const GENERATION_FUNCTION_RETRIES = GENERATION_RETRIES;
