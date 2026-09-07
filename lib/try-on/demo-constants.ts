/**
 * Total multipart ceiling for the demo route: two 8 MB images plus multipart
 * framing overhead. Enforced as an early Content-Length guard, not a streaming
 * hard cap; the per-file 8 MB validation remains the authoritative image bound.
 */
export const DEMO_MAX_MULTIPART_BODY_BYTES = 20 * 1024 * 1024;
