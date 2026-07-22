# Supabase Phase 1 — Technical Foundation

Phase 1 adds Supabase client utilities, session refresh via `proxy.ts`, environment validation, and a development health endpoint. No business schema, RLS, auth pages, or dashboard.

## Deliverables

| File | Purpose |
|------|---------|
| `lib/env.ts` | Modern Supabase env vars with optional legacy fallbacks |
| `lib/supabase/client.ts` | Browser client (publishable key) |
| `lib/supabase/server.ts` | Cookie-based server client |
| `lib/supabase/admin.ts` | Secret-key client (`import "server-only"`) |
| `lib/supabase/health.ts` | Publishable-client connectivity check |
| `proxy.ts` | Session refresh only — no dashboard redirects |
| `app/api/health/supabase/route.ts` | Dev-only or secret-protected health check |
| `.env.example` | Modern Supabase key names |

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Optional: `INTERNAL_HEALTH_SECRET` (protects health endpoint outside development).

## Known upstream dependency advisories

These advisories are **transitive dependencies of `next@16.2.11`** (introduced during the Phase 0.5 Next.js upgrade). They are **not introduced by Supabase Phase 1** and remain unresolved until Vercel ships a patched Next.js release.

| Advisory | Package | Installed version | Patched version |
|----------|---------|-------------------|-----------------|
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | `sharp` (optional, via `next`) | 0.34.5 | ≥ 0.35.0 |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) / CVE-2026-41305 | `postcss` (nested, via `next`) | 8.4.31 | ≥ 8.5.10 |

The npm audit entry for `next` itself is an **aggregator** (flagged via `sharp` and nested `postcss`), not a separate advisory.

### Why these are not reachable through normal application paths

- **sharp:** The application does not import `sharp`. Person and item uploads in the try-on flow are sent to OpenAI, not decoded locally. There is no `next/image` usage. Open Graph images use edge-runtime `ImageResponse` (Satori), not sharp. Sharp would only run if Next.js's `/_next/image` optimizer were invoked with processable image input.
- **postcss (nested):** Used by Next.js at build time for static CSS compilation. The application does not parse user-controlled CSS or embed PostCSS stringify output into inline `<style>` elements. The dev-time Tailwind pipeline uses root `postcss@8.5.21`, which is already patched.

### Accepted risk (temporary)

This risk is **accepted temporarily** because no safe, supported, non-breaking dependency update is available (`npm audit fix --force` would downgrade Next.js and must not be used). Re-run `npm audit --omit=dev` after **every Next.js update** and reassess before deploying.

### Reassessment triggers

Immediate reassessment is required if any of the following are added:

- `next/image` or remote image optimization
- Local sharp-based image processing
- User-controlled CSS input
- Inline generated CSS embedded via PostCSS stringify output
