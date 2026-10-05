export type ParsedSafepayWebhook = {
  eventType: string | null;
  tracker: string | null;
};

function readTracker(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("track_")) {
    return value;
  }

  if (value && typeof value === "object" && "token" in value) {
    const token = (value as { token?: unknown }).token;

    if (typeof token === "string" && token.startsWith("track_")) {
      return token;
    }
  }

  return null;
}

export function parseSafepayWebhook(rawBody: string): ParsedSafepayWebhook | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const body = parsed as Record<string, unknown>;
  const eventType =
    typeof body.type === "string"
      ? body.type
      : typeof body.event === "string"
        ? body.event
        : null;
  const data = body.data;
  const dataRecord =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  const tracker =
    readTracker(body.tracker) ??
    (dataRecord ? readTracker(dataRecord.tracker) ?? readTracker(dataRecord.token) : null);

  return { eventType, tracker };
}

const ACTIONABLE_EVENTS = new Set(["payment.succeeded", "payment.failed"]);

export function isActionableSafepayEvent(eventType: string | null): boolean {
  return eventType === null || ACTIONABLE_EVENTS.has(eventType);
}
