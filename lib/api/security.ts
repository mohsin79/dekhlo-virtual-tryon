import "server-only";

import { NextResponse } from "next/server";

export function jsonNoStore<T>(body: T, init?: ResponseInit): NextResponse<T> {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

export function assertJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/json");
}

export function genericErrorResponse(message: string, status: number): NextResponse {
  return jsonNoStore({ error: message }, { status });
}

export function rateLimitedResponse(): NextResponse {
  return jsonNoStore({ error: "Too many requests. Please try again later." }, { status: 429 });
}
