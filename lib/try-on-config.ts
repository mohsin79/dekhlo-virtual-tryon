/** Orchestrator — gpt-5.6 works without org verification; gpt-4.1-mini is cheaper once verified. */
export const TRY_ON_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.6";

/** Image tool quality — medium is ~4× cheaper than high with similar try-on results. */
export const TRY_ON_IMAGE_QUALITY =
  (process.env.OPENAI_IMAGE_QUALITY as "low" | "medium" | "high" | "auto" | undefined) ||
  "medium";

/** Vision detail for uploaded photos — low cuts input token cost; the edit tool still sees both images. */
export const TRY_ON_VISION_DETAIL =
  (process.env.OPENAI_VISION_DETAIL as "low" | "high" | "auto" | undefined) || "low";
