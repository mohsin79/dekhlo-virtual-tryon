export function getPostHogKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || undefined;
}

export function getPostHogHost(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || undefined;
}

export function isPostHogConfigured(): boolean {
  return Boolean(getPostHogKey() && getPostHogHost());
}
