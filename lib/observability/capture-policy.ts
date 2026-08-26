/** HTTP statuses that represent expected application outcomes — never capture. */
export const EXPECTED_HTTP_STATUSES = new Set([
  400, 401, 403, 404, 409, 410, 415, 422, 429,
]);

export function shouldCaptureHttpStatus(status: number): boolean {
  return !EXPECTED_HTTP_STATUSES.has(status);
}

export function shouldCaptureRpcMappedStatus(status: number): boolean {
  return status >= 500;
}

export function isProviderExhaustionStatus(status: number): boolean {
  return status === 502 || status === 503;
}

const EXPECTED_ERROR_NAMES = new Set([
  "TryOnWorkerPermanentError",
  "NonRetriableError",
]);

export function isExpectedApplicationError(error: unknown): boolean {
  if (error instanceof Error) {
    if (EXPECTED_ERROR_NAMES.has(error.name)) {
      return true;
    }

    const message = error.message.toLowerCase();

    if (message.includes("session is not eligible for processing")) {
      return true;
    }
  }

  return false;
}

export function shouldCaptureError(error: unknown, httpStatus?: number): boolean {
  if (httpStatus !== undefined && !shouldCaptureHttpStatus(httpStatus)) {
    return false;
  }

  return !isExpectedApplicationError(error);
}
