# Production dependency security review — 2026-07-27

Post–Phase 7 review on branch `B2B-saas-implementation`. **No Phase 8 product work.** No `npm audit fix`, no `npm audit fix --force`, no Next.js downgrade, canary, or preview releases.

## Scope

- Production tree only for remediation targets: `npm audit --omit=dev`
- Next.js pinned at **16.2.11** (stable 16.x)

## npm audit — before remediation

| Field | Value |
|-------|--------|
| Command | `npm audit --omit=dev --json` |
| Completed | Yes |
| Exit code | **1** |
| High | **9** |
| Moderate / low / critical | 0 |

### Reported dependency paths (production)

1. **brace-expansion** (GHSA-mh99-v99m-4gvg, patched **5.0.8**)
   - `inngest@4.13.0` → `@opentelemetry/auto-instrumentations-node` → `@opentelemetry/resource-detector-gcp@0.56.0` → **`gcp-metadata@8.1.4`** → **`gaxios@7.1.3`** → **`rimraf@5.0.10`** → **`glob@10.5.0`** → **`minimatch@9.0.9`** → **`brace-expansion@2.1.2`**
   - Introduced with **Phase 7 Inngest** (OpenTelemetry GCP resource detector). Not present on the pre-Inngest production tree.

2. **postcss** (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849; patched **≥ 8.5.18**)
   - **`next@16.2.11`** → nested **`postcss@8.4.31`** (exact pin in Next’s package manifest)

3. **sharp** (GHSA-f88m-g3jw-g9cj; patched **≥ 0.35.0**)
   - **`next@16.2.11`** optional **`sharp@0.34.5`** (hoisted under `node_modules/sharp`)

**Direct dependency introducing `gcp-metadata`:** none at the app root; path is entirely transitive under **`inngest`**.

## `npm audit fix --omit=dev --dry-run --json` (rejected)

- Proposed **removing large sets of devDependencies** (Tailwind, ESLint, TypeScript tooling, etc.) while “fixing” production advisories — **unsafe** for this repo; not applied.
- Separate human-readable dry-run still suggests **`next@9.3.3`** via `npm audit fix --force` for PostCSS/Sharp — **rejected** (semver-major framework downgrade).

No changes to `package.json` or `package-lock.json` from dry-run.

## Remediations applied

### `package.json`

- Added direct **`postcss@8.5.21`** (production dependency) so Next can dedupe to a patched PostCSS alongside Tailwind/build tooling.
- **`overrides`:**
  - **`gaxios` → `rimraf@^6.1.3`** — replaces vulnerable rimraf 5 / glob 10 chain with rimraf 6 / glob 13 / minimatch 10.
  - **`minimatch@10.2.5` → `brace-expansion@5.0.8`** — scoped to minimatch 10 only (does **not** override minimatch 3 used by ESLint).
  - **`postcss@8.5.21`** — global override aligned with the direct dependency.
  - **`next.postcss` → `$postcss`**, **`next.sharp` → `0.35.0`**.

### `package-lock.json`

- Removed nested `node_modules/next/node_modules/postcss@8.4.31`; **`next`** now resolves **`postcss@8.5.21`** from the hoisted tree.
- **`sharp@0.35.0`** hoisted (optional).
- **`rimraf@6.1.3`**, **`glob@13.0.6`**, **`brace-expansion@5.0.8`** on the Inngest/gaxios path.

## npm audit — after remediation

| Command | Exit code | High (prod) | Notes |
|---------|-----------|-------------|--------|
| `npm audit --omit=dev --registry=https://registry.npmjs.org/` | **0** | **0** | Production tree clean |
| `npm audit` (includes dev) | **1** | **9** | Dev-only ESLint/minimatch@3 → `brace-expansion@1.1.16` |

### Remaining advisories (devDependencies only)

| Package | Version | Path | Patched | Why not upgraded here |
|---------|---------|------|---------|------------------------|
| `brace-expansion` | 1.1.16 | `eslint` / `eslint-config-next` → `minimatch@3.1.5` | 5.0.8 (5.x line) | Forcing 5.x under minimatch 3 **breaks ESLint** (`expand is not a function` during `npm run lint`). Dev-only; not shipped in production install (`npm ci --omit=dev`). |
| (same advisory counted per npm for related packages) | | | | Awaiting upstream ESLint ecosystem bumps or compatible override strategy. |

**Follow-up:** Re-check when `eslint`, `@eslint/config-array`, or `minimatch@3` dependents publish compatible `brace-expansion` fixes — target **2026-08-27**.

## Runtime verification (2026-07-27)

After overrides:

```text
npm ci
npm ls next postcss sharp brace-expansion
npm run test:unit          # 80 pass
npx supabase db reset --local
npx supabase test db --local   # 286 pass, 15 files
npx tsc --noEmit           # pass
npm run lint               # pass (4 existing warnings, 0 errors)
npm run build              # pass
npm run start              # smoke (port 3020 in this environment)
```

Production smoke:

| Check | Result |
|-------|--------|
| `GET /` | 200 |
| `GET /api/inngest` | 200 |
| `GET /demo` | 200 |
| `GET /auth/login` | 200 |
| `GET /dashboard` (unauthenticated) | 307 → `/auth/login?next=%2Fdashboard` |

## Installed versions (after)

| Package | Version | Role |
|---------|---------|------|
| `next` | **16.2.11** | Direct |
| `postcss` | **8.5.21** | Direct + deduped under `next` |
| `sharp` | **0.35.0** | Optional under `next` (overridden) |
| `brace-expansion` (prod) | **5.0.8** | Under `inngest` → … → `minimatch@10.2.5` |
| `rimraf` (prod) | **6.1.3** | Under `gaxios` |
| `glob` (prod) | **13.0.6** | Under `rimraf` |

## Risk assessment (Dekhlo exposure)

| Topic | Assessment |
|-------|------------|
| User-submitted CSS / PostCSS stringify | **Not currently reachable** — PostCSS runs at **build time** (Tailwind/config); merchants do not submit CSS for server-side PostCSS processing. |
| PostCSS source map / path traversal advisories | **Reduced exposure** — no attacker-controlled CSS documents or `sourceMappingURL` in runtime paths. |
| Sharp / libvips CVEs | **Reduced exposure** — `next.config.mjs` sets **`images.unoptimized: true`**; try-on and catalog flows do not use Sharp for merchant uploads (browser canvas resize + OpenAI/storage). Patched optional Sharp remains for Next’s optional install path only. |
| brace-expansion DoS (glob/minimatch) | **Not currently reachable through known application routes** — no user-controlled glob patterns; Inngest/GCP metadata chain is not invoked with untrusted brace patterns from HTTP handlers. |
| Upload types | JPEG, PNG, WebP only for person photos; GIF/TIFF/SVG rejected in validation (see unit tests). |
| npm audit fix --force / Next 9.x | **Not performed**. |

## Mitigations retained

- Stay on **Next.js 16.2.11** until upstream ships patched bundled PostCSS without forcing a downgrade.
- Keep **image optimization disabled**.
- Scope overrides narrowly; verify **lint/build/start** after each change.
- Track **dev-only** brace-expansion advisories separately from production `--omit=dev` gates.
