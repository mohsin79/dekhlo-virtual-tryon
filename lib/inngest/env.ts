export function isInngestDevMode(): boolean {
  return process.env.INNGEST_DEV === "1";
}

export function assertInngestEventSendingConfigured(): void {
  if (isInngestDevMode()) {
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    throw new Error("Inngest event configuration is unavailable.");
  }
}

export function getInngestEventKey(): string | undefined {
  return process.env.INNGEST_EVENT_KEY?.trim() || undefined;
}
