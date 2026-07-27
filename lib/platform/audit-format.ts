const ALLOWED_METADATA_KEYS = new Set([
  "amount",
  "operation",
  "actor_user_id",
  "balance_before",
  "balance_after",
  "transaction_type",
]);

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|path|storage|signed|hash|authorization|cookie|key/i;

export function formatAllowlistedAuditMetadata(
  metadata: unknown,
): Record<string, string | number | boolean> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (!ALLOWED_METADATA_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
      continue;
    }

    if (value === null) {
      continue;
    }
  }

  return result;
}

export function formatAllowlistedTransactionMetadata(
  metadata: unknown,
): Record<string, string> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const result: Record<string, string> = {};
  const source = metadata as Record<string, unknown>;

  if (typeof source.reason === "string" && source.reason.trim()) {
    result.reason = source.reason.trim();
  }

  if (typeof source.operation === "string" && source.operation.trim()) {
    result.operation = source.operation.trim();
  }

  if (typeof source.actor_user_id === "string" && source.actor_user_id.trim()) {
    result.actor_user_id = source.actor_user_id.trim();
  }

  if (typeof source.source === "string" && source.source.trim()) {
    result.source = source.source.trim();
  }

  return result;
}

export function summarizeAllowlistedMetadata(
  metadata: Record<string, string | number | boolean>,
): string | null {
  const parts = Object.entries(metadata).map(([key, value]) => `${key}: ${String(value)}`);

  return parts.length > 0 ? parts.join(" · ") : null;
}
