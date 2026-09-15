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

---

## Follow-up patch — 2026-08-24

Post–Phase 8B restoration/UI work on commit **`e1c5246`**. Application source unchanged for this remediation. No Phase 8C. No `npm audit fix`, no `npm audit fix --force`, Next.js remains **16.2.11**.

### Cause of temporary audit regression

Commit **`e1c5246`** did **not** modify `package.json` or `package-lock.json`. Production audit went from **0 → 4** because **new advisories** were published after the 2026-07-27 lockfile, against versions previously considered patched:

| Advisory | Package | Severity | Vulnerable range | Was installed | Patched |
|----------|---------|----------|------------------|---------------|---------|
| [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | `postcss` | moderate | `<=8.5.22` | 8.5.21 | **≥8.5.23** |
| [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | `nanoid` | high | `<3.3.18` | 3.3.16 (via PostCSS) | **3.3.18** |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | `brace-expansion` | high | `4.0.0–5.0.8` | 5.0.8 (prod override) | **5.0.9** |

`next@16.2.11` was flagged **moderate** only as a transitive effect of nested PostCSS.

### Patch-level remediations applied

| Package | Before | After | Method |
|---------|--------|-------|--------|
| `postcss` (direct + override) | 8.5.21 | **8.5.26** | Direct dependency + global override |
| `nanoid` | 3.3.16 | **3.3.18** | Transitive via patched PostCSS (`^3.3.17`) |
| `brace-expansion` (prod) | 5.0.8 | **5.0.9** | Scoped `minimatch@10.2.5` override only |

**Preserved unchanged:** `next@16.2.11`, `sharp@0.35.0`, `gaxios → rimraf@^6.1.3`, `next.postcss → $postcss`, dev ESLint/minimatch@3 tree.

Install command (pre-existing OpenAI/Zod peer resolution): `npm ci --legacy-peer-deps`.

### npm audit — after 2026-08-24 patch

| Command | Exit code | Production findings | Notes |
|---------|-----------|---------------------|--------|
| `npm audit --omit=dev --registry=https://registry.npmjs.org/` | **0** | **0** | Production tree clean |
| `npm audit --registry=https://registry.npmjs.org/` | **1** | Dev-only | ESLint/minimatch@3 → `brace-expansion@1.1.16`; `js-yaml@4.x` under ESLint tooling (dev-only, not in production `--omit=dev` tree) |

### Runtime verification (2026-08-24)

```text
npm ci --legacy-peer-deps
npm ls next postcss nanoid brace-expansion sharp
npm audit --omit=dev --registry=https://registry.npmjs.org/
npm run test:unit          # 174 pass
npx supabase db reset --local
npx supabase test db --local   # 360 pass, 20 files
npx tsc --noEmit           # pass
npm run lint               # pass (4 existing warnings, 0 errors)
npm run build              # pass
```

### Installed versions (after 2026-08-24)

| Package | Version | Role |
|---------|---------|------|
| `next` | **16.2.11** | Direct |
| `postcss` | **8.5.26** | Direct + deduped under `next` |
| `nanoid` | **3.3.18** | Transitive under `postcss` |
| `sharp` | **0.35.0** | Optional under `next` (overridden) |
| `brace-expansion` (prod) | **5.0.9** | Under `inngest` → … → `minimatch@10.2.5` |
| `brace-expansion` (dev) | **1.1.16** | Under ESLint → `minimatch@3.1.5` (dev-only) |

---

## Phase 8C.2 — `posthog-js` (2026-08-27)

Added **`posthog-js@1.421.2`** for client-side, consent-gated product analytics only.

| Check | Result |
|-------|--------|
| `npm audit --omit=dev` after install | **0 vulnerabilities** |
| Next.js peer compatibility | **16.2.11** (client-only SDK) |
| React compatibility | **19.x** |
| Server-side PostHog | **Not added** |

Install method: `npm install posthog-js@1.421.2 --legacy-peer-deps`

Production tree: `posthog-js@1.421.2` (direct dependency only; no `@posthog/next`).

Run `npm ls posthog-js` after install to confirm dependency isolation.

---

## Phase 8C.1 — `@sentry/nextjs` (2026-08-26)

Added **`@sentry/nextjs@10.71.0`** for server-side error observability only (no browser SDK in this phase).

| Check | Result |
|-------|--------|
| `npm audit --omit=dev` after install | **0 vulnerabilities** |
| Next.js peer compatibility | **16.2.11** supported |
| React peer compatibility | **19.x** supported |
| Node engines | **≥ 20.9** (project `engines`) |

Install method: `npm install @sentry/nextjs@10.71.0 --legacy-peer-deps` (same OpenAI/Zod peer resolution as existing deps).

No production dependency advisories introduced. Sentry adds build-time tooling via `@sentry/webpack-plugin` (dev/build only); source-map upload is disabled when `SENTRY_AUTH_TOKEN` is absent.

---

## `browserslist` advisories (2026-09-07)

Two advisories were published against `browserslist` after the Phase 8C.1/8C.2 installs, which
turned `npm audit --omit=dev` non-zero without any dependency change on our side.

| Advisory | Summary |
|----------|---------|
| [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM |
| [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | Uncaught crash / prototype write via untrusted `browserslist-stats.json` custom stats (`normalizeStats`) |

Affected: `<= 4.28.6` — Patched: `>= 4.28.7`

### Production dependency path

```text
@sentry/nextjs@10.71.0
└─ @sentry/bundler-plugin-core@5.3.0
   └─ @babel/core@7.29.7
      └─ @babel/helper-compilation-targets@7.29.7
         └─ browserslist@4.28.6
            └─ update-browserslist-db@1.2.3
               └─ browserslist (deduped)
```

It also appears in the dev tree under `autoprefixer@10.5.4`. Both resolve to the same hoisted
`node_modules/browserslist`. This is build-time tooling and is not reachable at application
runtime, but `npm audit --omit=dev` counts it because `@sentry/nextjs` is a production dependency.

### Remediation

| | Version |
|---|---|
| Before | `browserslist@4.28.6` |
| After | `browserslist@4.28.9` |

**No override was required.** Every parent range already accepted the patched release:

- `browserslist@^4.28.6` from `autoprefixer@10.5.4`
- `browserslist@^4.24.0` from `@babel/helper-compilation-targets@7.29.7`
- peer `browserslist@>= 4.21.0` from `update-browserslist-db`

Applied with normal dependency resolution, lockfile only:

```text
npm update browserslist --package-lock-only --legacy-peer-deps
npm ci --legacy-peer-deps
```

`package.json` was **not** modified — no direct dependency, no `overrides` entry. Only
`package-lock.json` changed, and the diff is confined to the `browserslist` subtree:
`browserslist` 4.28.6 → 4.28.9, `update-browserslist-db` 1.2.3 → 1.3.2, plus its data packages
`baseline-browser-mapping`, `caniuse-lite`, `electron-to-chromium`, and `node-releases`.

Resolution stayed inside the `4.28.x` line. `4.28.9` (not `4.28.8`) is what the existing ranges
naturally resolve to, since it is now the current `4.28.x` patch release; both are above the
`>= 4.28.7` patched threshold. Next.js and Sentry versions were unchanged, and `npm audit fix`
was not run.

### Verification (2026-09-07)

```text
npm ls browserslist --omit=dev        # browserslist@4.28.9 (no 4.28.6 anywhere)
npm audit --omit=dev                  # found 0 vulnerabilities
npm run test:unit                     # 272 pass
npx tsc --noEmit                      # pass
npm run lint                          # pass (4 existing warnings, 0 errors)
npm run build                         # pass (Next.js 16.2.11)
npx supabase db reset --local
npx supabase test db --local          # 360 pass, 20 files
```

### Outstanding (dev-only, not remediated here)

Two further advisories are newly published against the **dev** tree only and do not affect the
production audit. They are tracked separately and were deliberately left out of this change:

- `brace-expansion` `<= 1.1.17` (dev, under ESLint → `minimatch@3.x`) — GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895
- `js-yaml` `4.0.0 - 4.3.0` (dev) — GHSA-5p4m-2wfm-xmqj

---

## Next.js / Sharp security release — Phase 8C.4E (2026-09-15)

Starting commit **`2f07b8d`** (Phase 8C.4D). **Dependency-security slice only** — no product work,
no `npm audit fix`, no `npm audit fix --force`, no Next.js downgrade, canary, preview or beta.

### Cause: new advisories against a previously clean baseline

The production tree was last recorded at **0 vulnerabilities** on 2026-09-07 (the `browserslist`
patch). It moved to **2 production vulnerabilities** with **no dependency change on our side**:
commit `2f07b8d` did not touch `package.json` or `package-lock.json`. These advisories were
published upstream after that lockfile was written, against the already-pinned `next@16.2.11` and
the `sharp@0.35.0` that an earlier override in this very document had installed as the *patched*
version at the time.

| Advisory | Package | Severity | Vulnerable range | Was installed | Patched |
|---|---|---|---|---|---|
| [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | `next` | critical | `15.6.0-canary.0 - 16.3.2` (and older lines) | 16.2.11 | **16.3.3+** |
| [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) | `next` | critical | same ranges | 16.2.11 | **16.3.3+** |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | `sharp` | high | `< 0.35.4` | 0.35.0 | **0.35.4** |

`GHSA-2xp9-vwfh-vxw4` is unauthenticated RCE in the Image Optimization API via AVIF files.
`GHSA-p293-qw3h-jr36` is unauthenticated RCE on Windows-hosted servers. `GHSA-rgj7-g3m4-5g8c`
carries the upstream libheif issues GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545.

Recorded vulnerable paths before remediation:

```text
npm explain next   -> next@16.2.11 from the root project (node_modules/next)
npm explain sharp  -> sharp@0.35.0 optional overridden (was "^0.34.5") from next@16.2.11
npm audit --omit=dev --json -> {"high":1,"critical":1,"total":2}
                               fixAvailable: next@16.3.5 (isSemVerMajor: false)
```

### The obsolete override that would have blocked the patch

This is the load-bearing finding of this slice. `package.json` carried an override added on
2026-07-27:

```json
"next": { "postcss": "$postcss", "sharp": "0.35.0" }
```

That override existed to push `sharp` **up** past a then-vulnerable `0.34.x`, because
`next@16.2.11` declared `optionalDependencies.sharp: "^0.34.5"` — a caret range that can never
reach `0.35.x`. Upstream has since moved on: `next@16.3.5` declares
`optionalDependencies.sharp: "^0.35.4"`.

The override had therefore inverted its purpose. What once raised `sharp` to safety would now
**pin it down** at the vulnerable `0.35.0` and silently defeat the upgrade. It was **removed**, not
re-pointed, so that ordinary transitive resolution supplies the patched release.

| | Before | After | Method |
|---|---|---|---|
| `next` (direct, exact) | 16.2.11 | **16.3.5** | `npm install next@16.3.5 --save-exact --legacy-peer-deps` |
| `sharp` (optional under `next`) | 0.35.0 (overridden) | **0.35.4** | **normal transitive resolution** after removing the stale override |
| `@swc/helpers` | 0.5.15 | 0.5.23 | transitive with `next` |
| `react` / `react-dom` | 19.2.8 | **19.2.8 (unchanged)** | — |

**No new override was added, and no direct `sharp` dependency was introduced.** `16.3.5` is the
current `latest` dist-tag. `next.postcss → $postcss` was **kept**: `next@16.3.5` pins
`postcss@8.5.23` internally, and the override continues to dedupe it to the hoisted direct
`postcss@8.5.26` rather than nesting a second copy.

No React change was required. `next@16.3.5` declares
`peerDependencies.react: "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0"`, which `19.2.8`
satisfies. `engines.node` is `>=20.9.0` for both 16.2.11 and 16.3.5, matching the project's own
`engines`.

### Lockfile blast radius

`npm ci --legacy-peer-deps` produced a tree whose lockfile diff is **0 packages added, 0 removed,
38 versions changed** — confined entirely to `next`, its `@next/swc-*` binaries, `@next/env`,
`@swc/helpers`, `sharp`, and the `@img/sharp-*` / `@img/sharp-libvips-*` platform packages
(`1.3.0 → 1.3.3`). No unrelated direct dependency was upgraded.

### npm audit — after remediation

| Command | Exit code | Findings | Notes |
|---|---|---|---|
| `npm audit --omit=dev --registry=https://registry.npmjs.org/` | **0** | **0 vulnerabilities** | **Production tree clean — this is the release gate** |
| `npm audit --registry=https://registry.npmjs.org/` | **1** | **2 high, dev-only** | See below; the full audit is **not** clean |

Remaining findings are **dev-only** and unchanged in character from the entries already tracked in
this document. They are not present in the production tree (`npm ls js-yaml --omit=dev` returns
empty) and are not installed by `npm ci --omit=dev`:

| Package | Version | Path | Advisories |
|---|---|---|---|
| `brace-expansion` | 1.1.16 | `eslint`, `eslint-config-next`, `@eslint/config-array`, `@eslint/eslintrc` → `minimatch@3.x` | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 |
| `js-yaml` | 4.3.0 | `eslint@9.39.5` → `@eslint/eslintrc@3.3.6` | GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh |

### Exposure assessment — and what it does not mean

Dekhlo's configuration limited practical exposure to the two critical advisories: `next.config.mjs`
sets `images: { unoptimized: true }` and `next/image` is imported nowhere, so the Image
Optimization route that `GHSA-2xp9-vwfh-vxw4` targets was not served; and the Render deployment
target is a Linux container, so `GHSA-p293-qw3h-jr36` did not apply.

**This does not mean `next@16.2.11` was safe.** A disabled feature is a configuration choice, not a
security boundary: it can be re-enabled by a one-line change, it does not cover advisories not yet
published against the same version, and it says nothing about code paths outside the optimizer.
The vulnerable version was replaced rather than reasoned around, and mitigation was treated as a
reason the risk was *bounded while remediation was pending* — not as a substitute for patching.

**Render deployment remained blocked until this remediation completed.** Phase 8C.4C's go/no-go gate
was amended by 8C.4D to require a clean production audit before any deploy; no Render service was
created while the production tree carried a critical advisory.

### Next.js 16.2.11 → 16.3.5 compatibility review

`16.3` is a performance and feature release; the breaking App Router changes landed in `16.0`, which
this project already ran. Reviewed against this repository:

| Surface | Result |
|---|---|
| `proxy.ts` / middleware | Already on the `proxy.ts` convention with an exported `proxy` function. The deprecated `middleware.ts` filename is **not** used, so no codemod was needed |
| App Router / route handlers | No change required. 16.3 swaps web streams for native Node streams in the rendering layer, documented as needing no application changes |
| `next.config.mjs` | `reactStrictMode`, `async headers()`, `experimental.serverActions.bodySizeLimit`, `images.unoptimized` all still supported |
| `experimental.serverActions.bodySizeLimit` | Unchanged at `"12mb"`; still applies to Server Actions only, not route handlers |
| Removed 16.x APIs | None in use — no `experimental.ppr`, `experimental.dynamicIO`, `images.domains`, `next/legacy/image`, or `amp` |
| `instrumentation.ts` / Sentry | `@sentry/nextjs@10.71.0` unchanged; `withSentryConfig` build passes; source-map upload still gated on `SENTRY_AUTH_TOKEN` |
| Turbopack build | Builds with Turbopack, as before |
| Node runtime, cookies, redirects, `next/font`, `server-only`, static metadata / sitemap / robots | No behavioral change observed in build or smoke output |

**No application code change was required for compatibility.** The only source edit in this slice is
a corrected comment in `next.config.mjs`: it previously described `images.unoptimized` as temporary
"while Next.js ships with a patched optional sharp dependency", a condition this upgrade has now
satisfied. Leaving that text would have invited someone to enable the optimizer on the grounds that
the stated precondition was met, so it now records the standing decision and the CSP/sharp review
that re-enabling would require.

#### New non-blocking deprecation warning

The 16.3.5 build emits:

```text
⚠ The Edge Runtime is deprecated. You can use the "nodejs" runtime instead.
⚠ Using edge runtime on a page currently disables static generation for that page
```

Source is pre-existing application code untouched by this slice:
`app/opengraph-image.tsx` declares `export const runtime = "edge"`. The build **succeeds**, so this
is not a compatibility blocker and was deliberately **not** changed here — switching that route to
the Node runtime is an application behavior change and belongs in its own slice. Tracked as
follow-up; the Edge Runtime is deprecated and will be removed in a future major.

### Verification (2026-09-15)

```text
npm install next@16.3.5 --save-exact --legacy-peer-deps
npm ci --legacy-peer-deps
npm ls next sharp react react-dom     # next@16.3.5, sharp@0.35.4, react/react-dom@19.2.8
npm audit --omit=dev                  # found 0 vulnerabilities
npm audit                             # 2 high, dev-only (brace-expansion, js-yaml)
npx supabase db reset --local
npx supabase test db --local          # 360 pass, 20 files
npm run test:unit                     # 454 pass, 110 suites, 0 fail
npx tsc --noEmit                      # pass
npm run lint                          # 0 errors, 4 baseline warnings
npm run build                         # pass (Next.js 16.3.5, Turbopack)
npx next start -p 3020                # production smoke, stopped afterwards
```

Production start smoke (temporary server on port 3020, no OpenAI call, no credit consumed):

| Check | Result |
|---|---|
| `GET /` | 200 |
| `GET /auth/login` | 200 |
| `GET /demo` | 200 |
| `GET /try/nope/nope` | 404 |
| `GET /dashboard` (unauthenticated) | 307 → `/auth/login?next=%2Fdashboard` |
| `GET /platform` (unauthenticated) | 307 → `/auth/login?next=%2Fplatform` |

Phase 8C.3C headers re-verified against the live 16.3.5 production server:
`X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`;
`Permissions-Policy: camera=(self), geolocation=(), microphone=()`;
`Strict-Transport-Security: max-age=31536000; includeSubDomains`; CSP present as
**`Content-Security-Policy-Report-Only`** only. No enforcing `Content-Security-Policy`, no
`X-Frame-Options`, no `frame-ancestors`, no COOP/CORP/COEP. The production policy contains no
`'unsafe-eval'` and no development websocket or `localhost` sources.

### Installed versions (after 2026-09-15)

| Package | Version | Role |
|---|---|---|
| `next` | **16.3.5** | Direct, exact pin |
| `sharp` | **0.35.4** | Optional under `next`, **no override** |
| `react` / `react-dom` | **19.2.8** | Direct, unchanged |
| `postcss` | **8.5.26** | Direct + deduped under `next` via `$postcss` |
| `@swc/helpers` | 0.5.23 | Transitive under `next` |
| `eslint-config-next` | 16.2.11 (dev) | Left unchanged; lints `next@16.3.5` with no new findings |

This record is an engineering change log, not a security certification or audit attestation. It
reports the advisories npm surfaced on the dates shown and the remediation applied; it makes no
claim about vulnerabilities not yet published or not detected by `npm audit`.
