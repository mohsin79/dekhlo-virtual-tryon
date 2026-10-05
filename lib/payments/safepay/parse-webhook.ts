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
  const notification =
    body.notification && typeof body.notification === "object" && !Array.isArray(body.notification)
      ? (body.notification as Record<string, unknown>)
      : null;
  const charge =
    dataRecord?.charge && typeof dataRecord.charge === "object" && !Array.isArray(dataRecord.charge)
      ? (dataRecord.charge as Record<string, unknown>)
      : null;

  const tracker =
    readTracker(body.tracker) ??
    (notification ? readTracker(notification.tracker) : null) ??
    (dataRecord ? readTracker(dataRecord.tracker) ?? readTracker(dataRecord.token) : null) ??
    (charge ? readTracker(charge.tracker) : null);

  return { eventType, tracker };
}

export function isActionableSafepayEvent(eventType: string | null): boolean {
  if (eventType === null) {
    return true;
  }

  // Express Checkout docs use payment.succeeded. The merchant webhook envelope
  // uses payment:created / payment:succeeded (getsafepay/safepay-dotnet).
  return eventType.startsWith("payment.") || eventType.startsWith("payment:");
}
