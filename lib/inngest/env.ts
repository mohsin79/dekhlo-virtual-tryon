type InngestDevModeEnv = {
  INNGEST_DEV?: string;
  NODE_ENV?: string;
};

/**
 * Dev mode disables Inngest request signature verification, so production must never
 * enter it — an INNGEST_DEV=1 value that leaks into a production environment is ignored.
 */
export function resolveInngestDevMode(env: InngestDevModeEnv = process.env): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }

  return env.INNGEST_DEV === "1";
}

export function isInngestDevMode(): boolean {
  return resolveInngestDevMode(process.env);
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
