export const TRY_ON_GENERATION_FAILED_MESSAGE = "Try-on generation failed. Please try again.";

export const TRY_ON_SERVICE_UNAVAILABLE_MESSAGE =
  "The try-on service is temporarily unavailable.";

const FORBIDDEN_CLIENT_FRAGMENTS = [
  "OPENAI_API_KEY",
  "openai",
  "sk-",
  "stack",
  "Error:",
  "at ",
  "environment",
  "configured yet",
];

export function isClientSafeTryOnErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return !FORBIDDEN_CLIENT_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment.toLowerCase()),
  );
}

export function toClientSafeGenerationFailureMessage(): string {
  return TRY_ON_GENERATION_FAILED_MESSAGE;
}
