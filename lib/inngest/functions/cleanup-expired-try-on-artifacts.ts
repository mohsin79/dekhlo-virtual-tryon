import { inngest } from "@/lib/inngest/client";
import { captureUnexpectedError } from "@/lib/observability/sentry";
import { CLEANUP_BATCH_SIZE } from "@/lib/try-on/cleanup/constants";
import { cleanupExpiredSession } from "@/lib/try-on/cleanup/expired-session-cleanup";
import { listExpiredSessionsForCleanup } from "@/lib/try-on/sessions/service";

export const cleanupExpiredTryOnArtifacts = inngest.createFunction(
  {
    id: "cleanup-expired-try-on-artifacts",
    triggers: [{ cron: "0 * * * *" }],
    onFailure: async ({ error }) => {
      captureUnexpectedError(error, {
        routeCategory: "inngest_worker",
        operation: "cleanup_expired_try_on_artifacts",
        errorCategory: "cleanup_failure",
        inngestFunctionId: "cleanup-expired-try-on-artifacts",
      });
    },
  },
  async ({ step }) => {
    const sessions = await step.run("load-expired-sessions", async () =>
      listExpiredSessionsForCleanup(CLEANUP_BATCH_SIZE),
    );

    let cleaned = 0;

    for (const session of sessions) {
      await step.run(`cleanup-session-${session.id}`, async () => {
        await cleanupExpiredSession(session);
        return { sessionId: session.id };
      });
      cleaned += 1;
    }

    return { cleaned, batchSize: CLEANUP_BATCH_SIZE };
  },
);

export { CLEANUP_BATCH_SIZE };
