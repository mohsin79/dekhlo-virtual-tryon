import "server-only";

import { inngest } from "@/lib/inngest/client";
import {
  TRY_ON_GENERATION_REQUESTED,
  tryOnGenerationEventId,
} from "@/lib/inngest/events";
import { assertInngestEventSendingConfigured } from "@/lib/inngest/env";

export type DispatchTryOnGenerationResult =
  | { ok: true }
  | { ok: false; message: string };

export async function dispatchTryOnGeneration(input: {
  sessionId: string;
  brandId: string;
}): Promise<DispatchTryOnGenerationResult> {
  try {
    assertInngestEventSendingConfigured();
  } catch {
    return { ok: false, message: "Generation dispatch is temporarily unavailable." };
  }

  try {
    await inngest.send({
      name: TRY_ON_GENERATION_REQUESTED,
      data: {
        sessionId: input.sessionId,
        brandId: input.brandId,
      },
      id: tryOnGenerationEventId(input.sessionId),
    });

    return { ok: true };
  } catch {
    return { ok: false, message: "Generation dispatch is temporarily unavailable." };
  }
}
