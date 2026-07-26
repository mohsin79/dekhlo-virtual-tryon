import "server-only";

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  cleanupExpiredTryOnArtifacts,
  processTryOnGeneration,
} from "@/lib/inngest/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processTryOnGeneration, cleanupExpiredTryOnArtifacts],
});
