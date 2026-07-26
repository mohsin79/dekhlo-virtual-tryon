export const TRY_ON_GENERATION_REQUESTED = "dekhlo/try-on.generation.requested" as const;

export type TryOnGenerationRequestedEvent = {
  name: typeof TRY_ON_GENERATION_REQUESTED;
  data: {
    sessionId: string;
    brandId: string;
  };
};

export function tryOnGenerationEventId(sessionId: string): string {
  return `try-on-generation:${sessionId}`;
}
