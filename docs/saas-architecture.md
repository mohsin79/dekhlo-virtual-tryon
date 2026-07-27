# Dekhlo SaaS Architecture

**Status:** Phase 0 — architecture only (no Supabase implementation yet)  
**Last updated:** 2026-07-22 (revision 5)  
**Scope:** Convert the existing Next.js virtual try-on MVP into a production-ready, multi-tenant B2B SaaS for Pakistani clothing brands.

**Production framework target:** Next.js **16.x** stable (currently `16.2.11` on npm — install latest stable 16.x, not canary or preview).  
**Node.js:** ≥ 20.9 · **TypeScript:** ≥ 5.1 · **React:** 19.x (via Next.js 16)

Phase **0.5** (framework modernization) must complete **before** Phase 1 (Supabase).

---

## 1. Executive summary

Dekhlo today is a **stateless, single-tenant marketing site** on Next.js 14.2.5 with one public API route (`POST /api/try-on`) that calls OpenAI synchronously and returns a base64 image. There is no auth, database, storage, billing, or tenant isolation.

The SaaS target is a **multi-tenant B2B platform** where:

- Each **brand** (tenant) manages a product catalog and links shoppers to `/try/[brandSlug]/[productSlug]`.
- **Merchant users** authenticate via Supabase Auth and access a dashboard scoped to their brand(s).
- **End customers** upload **only their photo**; the product is pre-selected from the catalog.
- **Product images** are public (derived from storage paths); **customer photos and results** are private (signed URLs).
- **Credits** use `brand_credit_balances` + append-only `credit_transactions` — reserve only **after** photo upload, via atomic RPC.
- **Row Level Security (RLS)** enforces tenant isolation in PostgreSQL.

The existing OpenAI integration (`lib/try-on-prompt.ts`, `lib/try-on-config.ts`, generation logic in `app/api/try-on/route.ts`) is **preserved and wrapped**, not rewritten.

---

## 2. System architecture

### 2.1 High-level diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Vercel (Next.js 16.x stable)                          │
├──────────────────────────────────────────────────────────────────────────────┤
│  Public routes                    │  Merchant dashboard (protected, Phase 3+)│
│  /                                │  /dashboard/*                            │
│  /demo (rate-limited)             │  /dashboard/products, settings, billing  │
│  /try/[brandSlug]/[productSlug]   │                                          │
│  /login, /signup (Phase 3+)       │                                          │
├───────────────────────────────────┴──────────────────────────────────────────┤
│  proxy.ts — session refresh (@supabase/ssr); dashboard guard in Phase 3+       │
├──────────────────────────────────────────────────────────────────────────────┤
│  API Routes (App Router)                                                     │
│  /api/try-on/sessions     → session create → upload → queue → generate        │
│  /api/brands/*            → merchant CRUD (publishable client + RLS)         │
│  /api/products/*          → catalog (publishable client + RLS)               │
│  /api/storage/sign        → short-lived signed URLs (server-only)             │
│  /api/demo/*              → rate-limited demo try-on (Phase 6+)               │
│  /api/inngest             → Inngest webhook                                  │
│  /api/health/supabase     → dev-only or internal-secret protected             │
├──────────────────────────────────────────────────────────────────────────────┤
│  Server libraries                                                            │
│  lib/supabase/client.ts      browser client (publishable key)                │
│  lib/supabase/server.ts      server client (cookies, RLS)                    │
│  lib/supabase/admin.ts       secret key client (import "server-only")        │
│  lib/env.ts                  Zod env validation                              │
│  lib/try-on/*                preserved OpenAI generation (unchanged logic)   │
│  lib/credits/*               wrappers calling PostgreSQL RPC                 │
└──────────┬──────────────────────┬──────────────────────┬─────────────────────┘
           │                      │                      │
           ▼                      ▼                      ▼
   ┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
   │   Supabase    │    │  Upstash Redis  │    │    Inngest      │
   │  PostgreSQL   │    │  rate limiting  │    │  background jobs│
   │  Auth         │    └─────────────────┘    └─────────────────┘
   │  Storage      │
   │  RLS + RPCs   │
   └───────────────┘
           │
           ▼
   ┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
   │    OpenAI     │    │     Resend      │    │  Sentry/PostHog │
   │  Responses API│    │  transactional  │    │  observability  │
   └───────────────┘    └─────────────────┘    └─────────────────┘
```

### 2.2 Architectural principles

| Rule | Implementation |
|------|----------------|
| Multi-tenant | Every merchant-owned row has `brand_id`; RLS filters by membership |
| Never trust the client | `brand_id`, credits, roles derived server-side from trusted records |
| Private media | Customer photos + results in private buckets; signed URLs only |
| Public media | Product images from public bucket; URLs derived at runtime from paths |
| Atomic credits | PostgreSQL RPCs: reserve, consume, release, grant; all idempotent |
| No mutable balance on `brands` | Available = `granted - reserved - consumed` from `brand_credit_balances` |
| Credits after upload | **Never** reserve before session row exists or before photo upload completes |
| Publishable client default | Merchant CRUD uses authenticated publishable client + RLS |
| Secret key restricted | `lib/supabase/admin.ts` with `import "server-only"`; infrastructure only |
| No separate backend | Next.js App Router + Supabase + Inngest |
| Preserve AI integration | Extract to `lib/try-on/generate.ts`; prompt and config unchanged |

### 2.3 Technology stack mapping

| Layer | Technology | Role |
|-------|------------|------|
| Frontend | Next.js 16 App Router, TypeScript ≥5.1, Tailwind, shadcn/ui | Marketing, `/demo`, dashboard, product try-on |
| Forms | React Hook Form + Zod | Dashboard forms |
| Database | Supabase PostgreSQL | Tenants, products, sessions, credits, leads, audit |
| Auth | Supabase Auth + `@supabase/ssr` | Cookie session refresh in `proxy.ts` (Next.js 16) |
| API keys | Publishable + secret (modern) | Legacy anon/service_role optional fallback only |
| Storage | Supabase Storage | Paths stored in DB; URLs derived at runtime |
| Authorization | PostgreSQL RLS + role checks | Separate SELECT/INSERT/UPDATE/DELETE policies |
| Rate limiting | Upstash Redis | Per-IP, per-cookie, per-brand; demo caps |
| Background jobs | Inngest | Async try-on, retention cleanup |
| Email | Resend | Invites, alerts |
| Errors | Sentry | Full provider errors server-side only |
| Analytics | PostHog | Product analytics |
| Deploy | Vercel on Node ≥20.9 | |
| AI | OpenAI Responses API (existing) | **Behavior preserved** |

---

## 3. Authentication flow

### 3.1 Actors

| Actor | Auth required | Scope |
|-------|---------------|-------|
| Platform admin | Yes (future) | Cross-tenant via audited secret-key operations |
| Brand staff | Yes | One or more brands via `brand_members` |
| End customer | No | `/try/[brandSlug]/[productSlug]` — person photo only |
| Demo visitor | No | `/demo` — rate-limited two-image flow |

### 3.2 Merchant auth flow (Phase 3+)

```
1. User visits /login
2. Submits credentials
3. Supabase Auth → @supabase/ssr sets cookies
4. proxy.ts refreshes session on matched routes
5. Server loads profiles + brand_members
6. No membership → onboarding
7. Dashboard scoped by active brand
```

**Server-side authorization (merchant operations):**

```typescript
const supabase = await createServerClient();       // publishable key + cookies, RLS
const user = await getAuthenticatedUser(supabase);
const brand = await getBrandForUser(user.id, slug); // from DB, NOT request body
if (!brand) throw forbidden();
```

### 3.3 Session refresh — Next.js 16 + `proxy.ts`

Next.js 16 replaces deprecated `middleware.ts` with **`proxy.ts`** at the project root. The exported function is named **`proxy`**, not `middleware`.

```typescript
// proxy.ts — Next.js 16 + @supabase/ssr
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

**Migration (Phase 0.5):** `npx @next/codemod@latest middleware-to-proxy .`

- Phase 1: session refresh in `proxy.ts` only — **no dashboard redirects**.
- Phase 3: add `/dashboard/*` redirect to `/login` when unauthenticated (after auth pages exist).

### 3.4 Brand invitation flow (later phase)

Owner or admin invites → Resend email → invitee accepts → `brand_members` inserted server-side with role from invite record.

---

## 4. Tenant isolation strategy

### 4.1 Model

- **Tenant = `brands`**
- **Profile = `profiles`** (extends `auth.users`)
- **Membership = `brand_members`** with role enum

### 4.2 Core table names (canonical)

| Table | Purpose |
|-------|---------|
| `profiles` | User profile (`avatar_path`, not full URL) |
| `brands` | Tenant record (`logo_path`) |
| `brand_members` | Membership + role |
| `products` | Catalog (`product_image_path`) |
| `try_on_sessions` | Try-on lifecycle + privacy fields |
| `brand_credit_balances` | Credit counters |
| `credit_transactions` | Append-only audit |
| `leads` | Shopper contact capture |
| `audit_logs` | Platform + brand audit trail (**Phase 8+**) |

### 4.3 Brand member roles and permissions

| Permission | owner | admin | editor | analyst |
|------------|:-----:|:-----:|:------:|:-------:|
| View dashboard & analytics | ✓ | ✓ | ✓ | ✓ |
| View try-on sessions | ✓ | ✓ | ✓ | ✓ (read-only) |
| View leads (shopper PII) | ✓ | ✓ | — | — |
| Manage products (CRUD) | ✓ | ✓ | ✓ | — |
| Upload product images | ✓ | ✓ | ✓ | — |
| Edit brand settings & widget | ✓ | ✓ | — | — |
| Invite / remove team members | ✓ | ✓ | — | — |
| Change member roles | ✓ | — | — | — |
| View credit balance & transactions | ✓ | ✓ | — | ✓ (read-only) |
| Purchase / request credits | ✓ | ✓ | — | — |
| Delete brand | ✓ | — | — | — |

### 4.4 RLS policy pattern

All merchant-scoped tables include `brand_id UUID NOT NULL REFERENCES brands(id)`.

**Do not use one broad `FOR ALL` policy.** Create separate policies:

#### SELECT — owner, admin, editor, analyst

```sql
CREATE POLICY "products_select_members"
  ON public.products FOR SELECT
  USING (
    brand_id IN (
      SELECT bm.brand_id FROM public.brand_members bm
      WHERE bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'editor', 'analyst')
    )
  );
```

#### INSERT — owner, admin, editor

```sql
CREATE POLICY "products_insert_editors"
  ON public.products FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = products.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'editor')
    )
  );
```

#### UPDATE — owner, admin, editor

```sql
CREATE POLICY "products_update_editors"
  ON public.products FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = products.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = products.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'editor')
    )
  );
```

#### DELETE — owner, admin, editor

```sql
CREATE POLICY "products_delete_editors"
  ON public.products FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = products.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'editor')
    )
  );
```

Every **INSERT** and **UPDATE** `WITH CHECK` must include the required role check, not only membership.

### 4.5 SECURITY DEFINER function guidance

Helper and RPC functions that bypass RLS must:

1. **`SET search_path = public, pg_temp`** (or minimal safe schema list)
2. Use **schema-qualified** identifiers (`public.brand_members`, not bare `brand_members`)
3. **`REVOKE ALL` from PUBLIC**; **`GRANT EXECUTE`** only to `authenticated` / `service_role` as appropriate
4. **Never accept arbitrary `brand_id`** without internal membership or session validation
5. **Avoid recursive RLS** — do not call helpers that re-query the same table under RLS in ways that recurse; prefer direct membership checks inside SECURITY DEFINER bodies

Example safe helper skeleton:

```sql
CREATE OR REPLACE FUNCTION public.user_has_brand_role(
  p_brand_id uuid,
  p_roles text[]
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = p_brand_id
      AND bm.user_id = auth.uid()
      AND bm.role = ANY(p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_brand_role(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_brand_role(uuid, text[]) TO authenticated;
```

RLS policies introduced in **Phase 2**, not Phase 1.

### 4.6 Secret key usage (restricted)

| Use case | Client |
|----------|--------|
| Merchant dashboard CRUD | **Publishable** server/browser client + RLS |
| Public product read (try-on page) | Publishable client + public SELECT policies |
| Try-on processing (Inngest) | Secret client — session validated from trusted row |
| Storage cleanup / retention | Secret client — path validated |
| Platform admin credit ops | Secret client + RPC + audit log |
| Signed URL generation (private) | Secret client or RPC wrapper |

**Secret key rules:**

- Imported **only** through `lib/supabase/admin.ts` containing `import "server-only"`
- Never in `NEXT_PUBLIC_*` variables
- Never used for routine merchant CRUD
- Never returned, logged, or exposed in API responses
- Never tested or displayed by the health endpoint

Credit mutations run through **PostgreSQL RPC functions**, not ad-hoc secret-key table updates.

---

## 5. Storage strategy

### 5.1 Store paths, not environment-specific URLs

| Entity | Column | URL derivation |
|--------|--------|----------------|
| `profiles` | `avatar_path` | Signed or public URL at runtime |
| `brands` | `logo_path` | Public URL from `product-images` or CDN helper |
| `products` | `product_image_path` | Public URL at runtime |
| `try_on_sessions` | `person_storage_path`, `result_storage_path` | Signed URL, ≤ 15 min TTL |

**Do not store** full `https://…supabase.co/…` URLs in merchant-owned columns — paths only.

### 5.2 Buckets

| Bucket | Visibility | Contents |
|--------|------------|----------|
| `product-images` | **Public** | Catalog + brand logos |
| `customer-uploads` | **Private** | Shopper person photos |
| `try-on-results` | **Private** | AI-generated images |

### 5.3 Path conventions

```
product-images/{brand_id}/{product_id}/{filename}
product-images/{brand_id}/logo/{filename}
customer-uploads/{brand_id}/{session_id}/person.{ext}
try-on-results/{brand_id}/{session_id}/result.png
```

### 5.4 Upload flows

**Product image (merchant):** authenticated publishable client + RLS → store `product_image_path`.

**Customer photo (merchant try-on route):**

1. Create `try_on_sessions` (`pending_upload`) — **no credit reservation**
2. Signed upload URL for person photo only
3. Product image read from `products.product_image_path` at generation time

**Generated result:** worker writes `result_storage_path`; client receives signed URL.

### 5.5 Storage retention rules

| Asset / condition | Retention |
|-------------------|-----------|
| Failed or incomplete customer uploads | Delete within **24 hours** |
| Completed sessions **without** `consent_to_store` | Delete artifacts within **24 hours** |
| Completed sessions **with** `consent_to_store = true` | Retain **30 days** |
| Merchant product images | Retain while product exists |

Enforced by Inngest cron + secret client. `expires_at` and `deleted_at` on `try_on_sessions` drive cleanup.

---

## 6. Try-on session lifecycle

### 6.1 Naming

Use **`try_on_sessions`**. May include `provider_job_id` for background processing.

### 6.2 States

```
pending_upload → queued → processing → completed
                    ↘ failed
                    ↘ cancelled
```

| Status | Meaning |
|--------|---------|
| `pending_upload` | Session created; awaiting customer photo — **no credits reserved** |
| `queued` | Upload validated; credits **reserved** via `queue_try_on_session` |
| `processing` | OpenAI in progress |
| `completed` | Result stored; credits **consumed** |
| `failed` | Eligible failure; reserved credits **released** |
| `cancelled` | Stopped; reserved credits **released** if applicable |

### 6.3 Correct session and credit sequence

**Do not** reserve credits before creating the session row.  
**Do not** reserve credits while the shopper has not completed photo upload.

```
 1. Validate active brand and product (server-side from slugs)
 2. Apply rate limits
 3. Create idempotent try_on_sessions row — status: pending_upload, credit_cost: null
    (keyed by unique client_request_id — see §6.6)
 4. Issue session-access token (§6.7); generate signed customer-photo upload URL
 5. Customer uploads photo
 6. Server validates completed upload
 7. Call atomic PostgreSQL RPC queue_try_on_session(p_session_id):
      a. Lock session row
      b. Verify status = pending_upload
      c. Verify upload validation passed
      d. Derive required cost from trusted server/database config (session → product → brand)
      e. Lock brand_credit_balances row
      f. Verify available credits ≥ required cost
      g. Reserve that exact amount; insert credit_transaction (type: reserve,
         idempotency_key: session:{sessionId}:reserve — server-generated)
      h. Store amount in try_on_sessions.credit_cost
      i. Set session status = queued
 8. Start sync or async generation
 9. Success → consume_reserved_brand_credits (uses stored credit_cost;
    idempotency_key: session:{sessionId}:consume)
10. Eligible failure → release_reserved_brand_credits (uses stored credit_cost;
    idempotency_key: session:{sessionId}:release)
```

**`queue_try_on_session`** must derive `brand_id` and credit cost internally from trusted session and product records — **never** accept `brand_id` or credit amount from the browser.

**`consume_reserved_brand_credits`** and **`release_reserved_brand_credits`** must use the **`credit_cost` stored on the session** at queue time. They must **never** recalculate cost from a plan or product that may have changed after the session was queued.

### 6.4 `credit_cost` snapshot

| Column | Notes |
|--------|-------|
| `credit_cost` | integer, nullable while `pending_upload` |

**On successful `queue_try_on_session`:**

1. Derive required cost from trusted server/database configuration
2. Reserve that amount in `brand_credit_balances`
3. Store the exact amount in `try_on_sessions.credit_cost`
4. Transition session to `queued`

**Rules:**

- **`pending_upload`:** `credit_cost` must be null or zero
- **`queued`, `processing`, `completed`:** `credit_cost` must be greater than zero
- **`failed`, `cancelled`:** `credit_cost` may be null or zero if the session never queued, **or** greater than zero if credits were previously reserved

**Database constraint (conceptual):**

```sql
CHECK (
  (
    status = 'pending_upload'
    AND COALESCE(credit_cost, 0) = 0
  )
  OR
  (
    status IN ('queued', 'processing', 'completed')
    AND credit_cost > 0
  )
  OR
  (
    status IN ('failed', 'cancelled')
    AND (
      credit_cost IS NULL
      OR credit_cost >= 0
    )
  )
)
```

**Migration tests must cover:**

- Failed before queue (`credit_cost` null or zero)
- Cancelled before queue (`credit_cost` null or zero)
- Failed after queue (`credit_cost` > 0; credits released)
- Cancelled after queue (`credit_cost` > 0; credits released)
- Completed generation (`credit_cost` > 0; credits consumed)

### 6.5 Sync vs async

| Path | When |
|------|------|
| Sync | Dev; completes within Vercel timeout (`maxDuration = 180`) |
| Async (Inngest) | Production default when queue preferred |

### 6.6 Session-create vs credit-operation idempotency

Two separate idempotency domains — **do not conflate them.**

| Domain | Key | Source | Purpose |
|--------|-----|--------|---------|
| Session creation | `client_request_id` | Client-provided (UUID) | Idempotent public session-create request |
| Credit operations | Server-generated, operation-specific | Server only | Safe retries of reserve / consume / release |

**Session creation:** `try_on_sessions.client_request_id` is unique. Re-posting the same `client_request_id` returns the existing session row.

**Credit transactions:** `idempotency_key` is **never** the client session key. Use deterministic server patterns:

```
session:{sessionId}:reserve
session:{sessionId}:consume
session:{sessionId}:release
```

The same reserve, consume, or release operation must safely return its prior result when retried. Reserve and consume remain **separate valid operations** with distinct keys.

### 6.7 Anonymous session access (IDOR protection)

Public try-on sessions use **`anonymous_token_hash`** to prevent insecure direct object reference (IDOR) attacks. **Knowing a session UUID alone must not authorize access.**

**On public session creation:**

1. Generate a cryptographically secure opaque **session-access token**
2. Return it via an **HttpOnly, Secure, SameSite** cookie where appropriate, or through a one-time secure response field
3. Store **only** a cryptographic hash in `anonymous_token_hash`
4. **Never** store the plaintext token in the database

**Every anonymous endpoint** that reads or mutates a try-on session must require **both**:

- Session ID
- Valid session-access token (hash compared with **timing-safe** comparison)

Applies to:

- Status polling
- Generation completion checks
- Signed upload URL creation
- Signed result URL creation
- Retry or cancellation actions

**Never expose** in public API responses:

- `person_storage_path`
- `result_storage_path`
- `anonymous_token_hash`

Signed result URLs may be generated **only after** validating the anonymous token **or** an authorized merchant membership (dashboard / RLS).

### 6.8 Preserving existing AI integration

```
lib/try-on/
  generate.ts      ← OpenAI Responses API (UNCHANGED)
  config.ts        ← try-on-config.ts (UNCHANGED)
  prompt.ts        ← try-on-prompt.ts (UNCHANGED)
  extract-image.ts
```

`/demo` preserves the existing two-image `TryOnStudio` experience (Phase 6 move from `/`).

---

## 7. Credit lifecycle

### 7.1 Data model

#### `brand_credit_balances`

| Column | Notes |
|--------|-------|
| `brand_id` | UUID PK |
| `granted_credits` | NOT NULL default 0 |
| `reserved_credits` | NOT NULL default 0 |
| `consumed_credits` | NOT NULL default 0 |
| `updated_at` | timestamptz |

**Available (derived, never stored):**

```
available = granted_credits - reserved_credits - consumed_credits
```

#### `credit_transactions` (append-only)

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `brand_id` | FK |
| `type` | See §7.2 |
| `amount` | **Positive integer always**; direction determined by type |
| `session_id` | FK → `try_on_sessions`, nullable — **column and FK added in Phase 6** when `try_on_sessions` exists |
| `idempotency_key` | Unique |
| `metadata` | JSONB (actor, reason) |
| `created_at` | |

### 7.2 Transaction types

| Type | When | Counter effect |
|------|------|----------------|
| `grant` | Trial, purchase, automated top-up | `granted += amount` |
| `reserve` | `queue_try_on_session` | `reserved += amount` |
| `consume` | Successful generation | `reserved -= amount`, `consumed += amount` |
| `release` | Eligible failure / cancellation | `reserved -= amount` |
| `admin_grant` | Platform admin adds credits (**Phase 8+**) | `granted += amount` |
| `admin_revoke` | Platform admin removes credits (**Phase 8+**) | `granted -= amount` (if available) |

**No generic `adjust` type.** Use `admin_grant` and `admin_revoke` with positive amounts; type determines direction.

### 7.3 Administrative operations (Phase 8+)

`admin_grant` and `admin_revoke` transaction types and their RPCs are **not implemented until Phase 8**, when platform-admin authorization and `audit_logs` exist.

All `admin_grant` / `admin_revoke` operations require:

- Platform-admin authorization via `platform_role` (or equivalent secure model) — **not** merchant `brand_members` roles
- Mandatory `reason`
- `actor_user_id` recorded
- Row in `audit_logs`
- `idempotency_key`
- Atomic write of both `credit_transactions` and `audit_logs` records

Phase 5 `grant_brand_credits` is for trusted onboarding, purchases, and internal server scripts — it does **not** substitute for platform-admin operations.

### 7.4 PostgreSQL RPC functions

Functions are introduced **only in the phase where their referenced tables exist** (see §12).

#### Phase 5 — credit foundation (no `try_on_sessions`, no `audit_logs`, no platform-admin RPCs)

```sql
grant_brand_credits(p_brand_id uuid, p_amount int, p_idempotency_key text, p_metadata jsonb)
-- Read: authorization-safe view or RPC with internal membership check (see §7.5)
```

#### Phase 6 — session-linked lifecycle (requires `try_on_sessions`)

```sql
queue_try_on_session(p_session_id uuid)
consume_reserved_brand_credits(p_session_id uuid)
release_reserved_brand_credits(p_session_id uuid)
```

#### Phase 8 — platform-admin credit operations (requires `audit_logs`, `platform_role`)

```sql
admin_grant_brand_credits(p_brand_id uuid, p_amount int, p_idempotency_key text, p_reason text, p_actor uuid)
admin_revoke_brand_credits(p_brand_id uuid, p_amount int, p_idempotency_key text, p_reason text, p_actor uuid)
```

Server generates credit `idempotency_key` values internally (`session:{id}:reserve|consume|release`). RPC signatures do **not** accept client credit idempotency keys.

All functions: atomic, idempotent, SECURITY DEFINER only when needed, safe `search_path`, schema-qualified identifiers, `REVOKE ALL` from PUBLIC, minimal explicit grants, internal authorization.

`queue_try_on_session` encapsulates steps 7a–7i from §6.3 including `credit_cost` snapshot.

### 7.5 Credit RPC execution permissions

| RPC | Callable by | NOT callable by |
|-----|-------------|-----------------|
| `queue_try_on_session` | Trusted server routes, Inngest workers (secret client / service role) | Public browser, publishable client |
| `consume_reserved_brand_credits` | Trusted server / worker infrastructure | Public browser |
| `release_reserved_brand_credits` | Trusted server / worker infrastructure | Public browser |
| `grant_brand_credits` | Trusted onboarding / purchase / internal server scripts only (**Phase 5**) | General authenticated merchants, public browser |
| `admin_grant_brand_credits` | Platform-admin infrastructure only (**Phase 8+**) | Merchants, public clients |
| `admin_revoke_brand_credits` | Platform-admin infrastructure only (**Phase 8+**) | Merchants, public clients |
| Credit balance read | RLS-protected query/view **or** RPC that **internally verifies brand membership** | Unscoped public access |

**Do not** grant a general-purpose credit-granting function to all authenticated users.

All credit RPCs must continue to use:

- SECURITY DEFINER only when necessary
- `SET search_path = public, pg_temp` (or minimal safe list)
- Schema-qualified identifiers
- `REVOKE ALL … FROM PUBLIC` + minimal `GRANT EXECUTE`
- Internal authorization checks (never trust caller-supplied `brand_id` without verification)
- `audit_logs` entry for **admin_grant** and **admin_revoke** only (Phase 8+)

---

## 8. Main database entities

### 8.1 Entity relationship

```
auth.users → profiles

brands
  ├── brand_members
  ├── products
  ├── try_on_sessions
  ├── brand_credit_balances (1:1)
  ├── credit_transactions
  └── leads

audit_logs (Phase 8+)
```

### 8.2 Table summaries

#### `profiles`

| Column | Notes |
|--------|-------|
| `id` | PK, FK → auth.users |
| `full_name` | |
| `avatar_path` | Storage path, not URL |
| `platform_role` | Nullable — platform-admin authorization (**added Phase 8**; e.g. `platform_admin`) |
| `created_at`, `updated_at` | |

#### `brands`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `name`, `slug` | Unique slug |
| `logo_path` | Storage path |
| `plan` | future |
| `widget_config` | JSONB |
| `created_at`, `updated_at` | |

No credit columns on `brands`.

#### `brand_members`

| Column | Notes |
|--------|-------|
| `brand_id`, `user_id` | PK |
| `role` | `owner`, `admin`, `editor`, `analyst` |

#### `products`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `brand_id` | FK |
| `name`, `slug` | Unique per brand |
| `product_image_path` | Public bucket path |
| `category`, `is_active`, `metadata` | |
| `created_at`, `updated_at` | |

#### `try_on_sessions`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `brand_id`, `product_id` | FK — product required for merchant route |
| `status` | enum |
| `credit_cost` | integer nullable — null/zero while `pending_upload`; **> 0** for queued/processing/completed; see §6.4 for failed/cancelled |
| `person_storage_path`, `result_storage_path` | Private paths — never exposed to anonymous clients |
| `upload_validated_at` | timestamptz nullable — set when upload validation passes |
| `provider_job_id`, `provider_request_id` | nullable |
| `consent_to_store` | boolean default **false** |
| `expires_at`, `deleted_at` | retention |
| `error_code`, `sanitized_error_message` | merchant-safe errors only |
| `client_request_id` | text, **unique** — idempotent session-create key from client |
| `anonymous_token_hash` | hash of session-access token — never exposed (see §6.7) |
| `created_at`, `completed_at` | |

Raw provider errors → Sentry/logs only.

#### `brand_credit_balances`, `credit_transactions`

See §7.

#### `leads`, `audit_logs`

`leads` — as defined in revision 2.

`audit_logs` — **Phase 8+**. Examples: `credit.admin_grant`, `credit.admin_revoke`, `member.invite`.

---

## 9. Public versus protected routes

### 9.1 Public

| Route | Purpose |
|-------|---------|
| `/` | Marketing landing (no try-on widget after Phase 6) |
| `/demo` | Two-image try-on — **rate-limited**, not unlimited |
| `/try/[brandSlug]/[productSlug]` | Merchant try-on — person photo only |
| `/login`, `/signup`, `/auth/callback` | Phase 3+ |
| `/api/try-on/sessions` | Brand-scoped session API |
| `/api/demo/*` | Demo generation (rate-limited) |
| `/api/inngest` | Inngest webhook |

**Not V1:** `/try/[brandSlug]` product picker.

### 9.2 Protected (Phase 3+)

| Route | Purpose |
|-------|---------|
| `/dashboard/*` | Merchant dashboard |
| `/api/brands/*`, `/api/products/*` | Publishable client + RLS |

### 9.3 `proxy.ts` phasing

| Phase | Behavior |
|-------|----------|
| 1 | Session refresh only — **no auth redirects** |
| 3 | Redirect unauthenticated `/dashboard/*` → `/login` |

Do **not** redirect to auth pages before Phase 3 builds them.

### 9.4 `/demo` security (Phase 6+)

Free for marketing but **not unlimited**:

| Control | Implementation |
|---------|----------------|
| Per-IP rate limiting | Upstash Redis |
| Anonymous cookie rate limiting | httpOnly demo session cookie |
| Daily attempt cap | Configurable env threshold |
| CAPTCHA / abuse challenge | When thresholds exceeded |
| Separate demo usage tracking | `demo_usage` table or Redis counters — not merchant credits |
| Configurable kill switch | Env flag disables `/demo` instantly |
| File size limits | Existing 8MB cap preserved |
| Dimension limits | Max width/height validated server-side |

---

## 10. Environment variable categories

### 10.1 Public (browser-safe)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Primary** — low-privilege client key (`sb_publishable_…`) |
| `NEXT_PUBLIC_POSTHOG_*`, `NEXT_PUBLIC_SENTRY_DSN` | Later phases |

### 10.2 Server-only secrets

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SECRET_KEY` | **Primary** — elevated key (`sb_secret_…`); `import "server-only"` module only |
| `OPENAI_*` | Existing AI config |
| `INTERNAL_HEALTH_SECRET` | Protects health endpoint outside development |
| `DEMO_KILL_SWITCH`, `DEMO_DAILY_CAP` | Demo abuse controls (Phase 6+) |
| `UPSTASH_*`, `INNGEST_*`, `RESEND_*`, `SENTRY_AUTH_TOKEN` | Later phases |

### 10.3 Legacy compatibility fallbacks (optional, temporary)

Read only if modern keys unset — remove after migration:

| Legacy | Maps to |
|--------|---------|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key |

`lib/env.ts` prefers modern names; logs deprecation warning if fallback used.

### 10.4 Phase 1 required env vars

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (or legacy anon fallback) |
| `SUPABASE_SECRET_KEY` | Yes (or legacy service_role fallback) — **not exposed by health endpoint** |
| OpenAI vars | No (unchanged in Phase 1) |

---

## 11. Health endpoint security

`GET /api/health/supabase` (Phase 1):

| Rule | Implementation |
|------|----------------|
| Availability | **Development only** OR protected by `INTERNAL_HEALTH_SECRET` header |
| Connectivity test | Publishable client only — e.g. lightweight Auth or REST ping |
| Secret key | **Never** tested, logged, or returned |
| Errors | Generic `{ status: "ok" \| "error" }` — no connection strings, keys, or stack traces |
| Response | No raw Supabase error messages |

---

## 12. Planned implementation phases

Each phase ends with: TypeScript, ESLint, tests (when present), production build, changed files report, env vars report, **stop for approval**.

### Phase 0 — Architecture ✅

- [x] `docs/saas-architecture.md` (revision 5)
- [ ] No application code

### Phase 0.5 — Framework modernization (before Supabase)

**Commit separately from Supabase work.**

- Upgrade to latest stable **Next.js 16.x** (not canary/preview; target `16.2.11+`)
- Upgrade React, React DOM, `eslint-config-next`, TypeScript types as required
- Ensure Node.js ≥ 20.9, TypeScript ≥ 5.1
- Run official codemod: `npx @next/codemod@latest upgrade` and `middleware-to-proxy` where applicable
- Replace `middleware.ts` → **`proxy.ts`** (`proxy` export)
- Update async `params`, `cookies`, `headers`, route handlers per Next.js 16
- Do **not** enable experimental features unnecessarily
- Preserve current UI and OpenAI try-on behavior
- Run tsc, ESLint, tests, production build
- Manually verify existing try-on flow
- Document breaking changes in `docs/nextjs-16-upgrade.md`

**Out of scope:** Supabase packages, business schema, dashboard.

### Phase 1 — Supabase technical foundation **only**

- `@supabase/supabase-js`, `@supabase/ssr`, `zod`
- `lib/supabase/client.ts` — publishable key
- `lib/supabase/server.ts` — cookie client
- `lib/supabase/admin.ts` — secret key + `import "server-only"`
- `lib/env.ts` — modern keys + optional legacy fallback
- `proxy.ts` — session refresh only (no dashboard redirect)
- `.env.example` — modern key names
- Health endpoint per §11
- Connection verification

**Out of scope:** Dashboard UI, shadcn, business tables, RLS (except connection verification), onboarding, auth pages.

### Phase 2 — Core schema, profiles & RLS

- Migrations: `profiles`, `brands`, `brand_members`, role enum
- Separate SELECT / INSERT / UPDATE / DELETE RLS policies per §4.4
- SECURITY DEFINER functions per §4.5
- Profile creation trigger on auth signup
- **Database policy tests** (pgTAP or Supabase test suite)

**Out of scope:** Dashboard redirect, auth pages.

### Phase 3 — Merchant auth & protected dashboard

- Login, signup, logout, password reset, auth callback
- **`proxy.ts` dashboard redirect** (only now that auth pages exist)
- Onboarding, dashboard shell (shadcn/ui initialized here)
- Brand switcher

### Phase 4 — Product catalog & public storage

- `products` table + RLS + `product_image_path`
- Public `product-images` bucket
- Dashboard product CRUD
- Public read for try-on page

### Phase 5 — Credit foundation

**No dependency on `try_on_sessions`, `audit_logs`, or platform-admin authorization.**

- `brand_credit_balances`
- `credit_transactions` (no `session_id` column yet — added in Phase 6)
- RPC: `grant_brand_credits` (trusted onboarding, purchases, internal server scripts)
- Authorization-safe credit balance reads (RLS view/query or membership-verifying RPC)
- Credit read RLS policies for `brand_credit_balances` and `credit_transactions`
- Tests: grants, available-credit calculations

**Out of scope for Phase 5:** `admin_grant_brand_credits`, `admin_revoke_brand_credits`, `queue_try_on_session`, consume, release.

### Phase 6 — Try-on sessions and session-linked credit lifecycle

- `try_on_sessions` (including `credit_cost`, `client_request_id`, `anonymous_token_hash`)
- Add `credit_transactions.session_id` column + FK to `try_on_sessions`
- RPCs: `queue_try_on_session`, `consume_reserved_brand_credits`, `release_reserved_brand_credits`
- Anonymous session-access token flow (§6.7)
- Extract `lib/try-on/generate.ts` (**no logic change**)
- Private storage buckets, signed URLs, path-based storage
- `/try/[brandSlug]/[productSlug]` — person upload only
- Move `TryOnStudio` → `/demo` with abuse controls (§9.4)
- Session API with correct credit sequence (§6.3)
- Upstash rate limiting (merchant routes)
- Tests: queue, consume, release, retries, concurrent requests, `credit_cost` immutability, IDOR/token auth, **`credit_cost` CHECK constraint cases (§6.4)**

### Phase 7 — Background jobs (Inngest)

- Async generation path
- `provider_job_id` tracking
- Session polling
- Retention cleanup cron

### Phase 8 — Platform administration, audit and hardening

- `platform_role` on `profiles` (or equivalent secure platform-admin authorization model)
- `audit_logs` table
- RPCs: `admin_grant_brand_credits`, `admin_revoke_brand_credits`
  - Require platform-admin authorization
  - Require actor, reason, and idempotency key
  - Atomically create both `credit_transactions` and `audit_logs` records
- `leads` table + capture UI
- Sentry, PostHog
- Security review of RLS, storage, credit RPCs, and admin operations

### Phase 9 — Billing & polish (future)

- Stripe, custom domains, embed SDK
- Extended platform admin console

---

## 13. Architectural conflicts with existing application

### 13.1 Critical

| # | Conflict | Current | Required | Phase |
|---|----------|---------|----------|-------|
| C1 | Framework | Next.js 14.2.5 | Next.js 16.x stable | 0.5 |
| C2 | No auth | Public `/api/try-on` | Brand-scoped sessions + credits | 5, 6 |
| C3 | No persistence | In-memory base64 | Storage paths + signed URLs | 6 |
| C4 | Homepage try-on | `TryOnStudio` on `/` | `/demo` + product try-on route | 6 |
| C5 | Credit timing | N/A | Reserve only after upload via RPC; snapshot in `credit_cost` | 6 |

### 13.2 Moderate

| # | Conflict | Phase |
|---|----------|-------|
| C6 | No `proxy.ts` | 0.5, 1 |
| C7 | Legacy Supabase key names in docs/env | 1 |
| C8 | Design system | shadcn in Phase 3 |

### 13.3 Non-conflicts (preserve)

| Item | Notes |
|------|-------|
| OpenAI Responses API flow | Extract unchanged to `lib/try-on/generate.ts` |
| `lib/try-on-prompt.ts`, `lib/try-on-config.ts` | **Unchanged** |
| `maxDuration = 180` | Keep for sync path |
| Organic CSS tokens | Marketing + `/demo` |

### 13.4 Target route structure

```
proxy.ts                              → Phase 0.5 / 1
app/(marketing)/page.tsx
app/demo/page.tsx                     → TryOnStudio (two-image, rate-limited)
app/try/[brandSlug]/[productSlug]/page.tsx
app/(auth)/login/page.tsx             → Phase 3
app/(dashboard)/dashboard/...
app/api/try-on/route.ts               → legacy; /demo-only after Phase 6
app/api/try-on/sessions/route.ts
app/api/health/supabase/route.ts      → Phase 1
```

---

## 14. Open decisions

| Decision | Resolution |
|----------|------------|
| Production framework | **Next.js 16.x stable** via Phase 0.5 before Supabase |
| Request interception | **`proxy.ts`** (Next.js 16 convention) |
| Supabase keys | **Publishable + secret**; legacy names optional fallback only |
| Primary try-on URL | `/try/[brandSlug]/[productSlug]` |
| Customer garment upload | **`/demo` only** — not on merchant routes |
| Credit reserve timing | **After upload validation** via `queue_try_on_session` (Phase 6) |
| Credit cost immutability | Stored on session as `credit_cost`; consume/release never recalculate |
| Session vs credit idempotency | `client_request_id` (create) vs server keys `session:{id}:reserve\|consume\|release` |
| Anonymous session access | Session UUID + session-access token required (IDOR protection) |
| Credit RPC grants | No general-purpose grant to all authenticated merchants (§7.5) |
| Admin credit ops | **`admin_grant` / `admin_revoke`** — Phase 8 only, after `audit_logs` + `platform_role` |
| Phase 5 credit scope | `grant_brand_credits` only — no admin RPCs, no `audit_logs` dependency |
| Merchant DB access | Publishable client + RLS |
| Secret key | Server-only module; never in health response |
| Dashboard auth redirect | **Phase 3** — not before auth pages exist |
| `/demo` | Free but rate-limited with kill switch |
| Storage | **Paths in DB**; URLs derived at runtime |
| AI integration | **Preserve** existing prompt, config, generation |

---

## 15. References

- Try-on route: `app/api/try-on/route.ts`
- Prompt/config: `lib/try-on-prompt.ts`, `lib/try-on-config.ts`
- Site constants: `lib/site.ts`
- Env template: `.env.example`
- Next.js 16 upgrade notes: `docs/nextjs-16-upgrade.md` (Phase 0.5)
- Supabase keys: [Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- Next.js proxy: [proxy.js convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)

---

## Appendix A — Revision 5 change log

| Section | Change |
|---------|--------|
| Header | revision 5 |
| §6.4 | Corrected `credit_cost` CHECK; explicit rules for failed/cancelled pre/post queue; migration test cases |
| §7.2 | Marked admin transaction types as Phase 8+ |
| §7.3 | Admin ops deferred to Phase 8; requires `platform_role` + `audit_logs` |
| §7.4 | Phase 5: `grant_brand_credits` only; admin RPCs moved to Phase 8 block |
| §7.5 | Admin RPC permissions marked Phase 8+; audit_logs only for admin ops |
| §8 | `profiles.platform_role` (Phase 8); `audit_logs` phased; `credit_cost` column note |
| §12 Phase 5 | Removed admin RPCs and revocation tests |
| §12 Phase 6 | Added CHECK constraint test cases |
| §12 Phase 8 | Platform admin, audit_logs, admin grant/revoke RPCs |
| §14 | Admin ops phasing; Phase 5 scope |
| Appendix A | Prior revision 4 log moved to Appendix B |

## Appendix B — Revision 4 change log

| Section | Change |
|---------|--------|
| Header | revision 4 |
| §6.3 | `credit_cost` snapshot on queue; server-generated credit idempotency keys; `client_request_id` on create |
| §6.4 (new) | `credit_cost` column rules and CHECK constraint |
| §6.6 (new) | Separate `client_request_id` vs credit transaction idempotency keys |
| §6.7 (new) | Anonymous session-access token; IDOR protection; timing-safe compare; never expose paths/hash |
| §7.1 | `session_id` column + FK added in Phase 6 only |
| §7.4 | Split RPCs: Phase 5 (grant/admin) vs Phase 6 (queue/consume/release) |
| §7.5 (new) | Explicit EXECUTE permissions per credit RPC |
| §8 | `try_on_sessions`: `credit_cost`, `client_request_id`; removed generic `idempotency_key` |
| §12 Phase 5 | Credit foundation only — no `try_on_sessions` dependency |
| §12 Phase 6 | Sessions + session-linked credit RPCs + tests |
| §13 C5 | Phase 6 only for reserve timing |
| §14 | credit_cost, idempotency, IDOR, RPC grant restrictions |
| Appendix A | Renamed prior log to Revision 3; this is Revision 4 |

## Appendix C — Revision 3 change log

| Section | Change |
|---------|--------|
| Header | Next.js 16.x target; Phase 0.5 prerequisite; revision 3 |
| §1 | Framework upgrade; credit-after-upload; path-based storage |
| §2.1 Diagram | Next.js 16; proxy.ts; publishable/secret clients; demo API; secured health |
| §2.2–2.3 | Secret key rules; no pre-upload credit reserve; modern keys |
| §3 | `proxy.ts` replaces middleware; Phase 3 dashboard guard; publishable client |
| §4.4 RLS | Separate SELECT/INSERT/UPDATE/DELETE policies; role in WITH CHECK |
| §4.5 (new) | SECURITY DEFINER: search_path, grants, no arbitrary brand_id |
| §4.6 | Renamed from service role → secret key usage table |
| §5 | Path-based storage; removed URL columns; avatar_path, logo_path, product_image_path |
| §6.3 | **Correct 10-step session/credit sequence**; `queue_try_on_session` RPC |
| §7 | Removed `adjust`; added `admin_grant`/`admin_revoke`; positive amounts only |
| §8 | Entity columns updated to paths; `upload_validated_at`; admin transaction types |
| §9.3–9.4 | Proxy phasing; **demo security** section |
| §10 | Modern Supabase env vars; legacy fallback; health secret |
| §11 (new) | Health endpoint security rules |
| §12 | **Phase 0.5** added; Phase 1 narrowed; Phase 2 gets RLS tests; Phase 3 gets auth + redirect |
| §13–14 | Updated conflicts and resolved decisions |
| §15 | Added upgrade doc + doc links |
| Appendix A | This log |

## Appendix D — Revision 2 change log

(See git history for revision 2 details — superseded by Appendix A for active reference.)
