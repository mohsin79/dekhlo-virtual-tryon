# Next.js 16 Upgrade (Phase 0.5)

Framework modernization only. No Supabase, auth, or SaaS features were added.

## Versions

| Package | Before | After |
|---------|--------|-------|
| `next` | 14.2.5 | **16.2.11** |
| `react` | ^18.3.1 (18.3.1 installed) | **19.2.8** |
| `react-dom` | ^18.3.1 (18.3.1 installed) | **19.2.8** |
| `eslint-config-next` | 14.2.5 | **16.2.11** |
| `eslint` | ^8.57.0 (8.57.1 installed) | **^9.39.5** |
| `@types/react` | ^18.3.3 | **19.2.17** |
| `@types/react-dom` | ^18.3.0 | **19.2.3** |
| `typescript` | ^5.5.3 | ^5.5.3 (unchanged) |
| `@types/node` | ^20.14.10 | ^20.14.10 (unchanged) |

## Node.js requirement

- **Required:** Node.js **≥ 20.9.0**
- **Verified during upgrade:** v22.22.0
- Added to `package.json`:

```json
"engines": {
  "node": ">=20.9.0"
}
```

## Git checkpoint

Pre-upgrade commit on branch `B2B-saas-implementation`:

```
d353648 docs: add B2B SaaS architecture (pre Next.js 16 upgrade checkpoint)
```

## Codemods executed

| Codemod | Result |
|---------|--------|
| `npx @next/codemod@canary upgrade latest` | Upgraded packages to Next 16.2.11 + React 19.2.8; attempted bundled codemods (some blocked on Vercel geo-IP prompt in non-interactive mode) |
| `npx @next/codemod@canary next-lint-to-eslint-cli . --force` | Created `eslint.config.mjs`; changed `lint` script from `next lint` to `eslint .` |
| `npx @next/codemod@canary middleware-to-proxy . --force` | No-op — no `middleware.ts` in this project |
| `npx @next/codemod@canary next-async-request-api . --force` | No-op — no sync `params`, `searchParams`, `cookies`, or `headers` usage |

## Files changed

| File | Change |
|------|--------|
| `package.json` | Dependency upgrades, `engines.node`, `lint` script, `@types` overrides |
| `package-lock.json` | Lockfile refresh |
| `eslint.config.mjs` | **New** — ESLint flat config via `eslint-config-next` |
| `tsconfig.json` | Next.js build auto-updated: `jsx: "react-jsx"`, added `.next/dev/types/**/*.ts` to `include` |
| `docs/nextjs-16-upgrade.md` | **New** — this document |

### Unchanged (reviewed for Next.js 16 compatibility)

- `next.config.mjs` — `experimental.serverActions.bodySizeLimit` retained (still valid for route handler / server action body limits)
- `app/layout.tsx`, `app/page.tsx`, `app/opengraph-image.tsx`
- `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`
- `app/api/try-on/route.ts` — OpenAI integration unchanged
- `components/TryOnStudio.tsx`, `components/Uploader.tsx`, `components/Logo.tsx`
- `lib/*` — site config, try-on prompt, try-on config unchanged

No `middleware.ts` → `proxy.ts` migration was required.

## Breaking changes encountered

### 1. `next lint` removed in Next.js 16

**Issue:** `next lint` no longer exists; `next build` no longer runs linting.

**Fix:** Ran `next-lint-to-eslint-cli` codemod. Lint script is now `eslint .` with flat config.

### 2. ESLint 10 incompatible with `eslint-config-next@16.2.11`

**Issue:** The upgrade codemod initially installed ESLint 10.7.0. Running `eslint .` failed:

```
TypeError: contextOrFilename.getFilename is not a function
Occurred while loading rule 'react/display-name'
```

**Cause:** Nested `eslint-plugin-react` in `eslint-config-next` still uses the ESLint 9 `context.getFilename()` API removed in ESLint 10 ([vercel/next.js#89764](https://github.com/vercel/next.js/issues/89764)).

**Fix:** Pinned `eslint` to `^9.39.5` (peer range `>=9.0.0` is satisfied; ESLint 10 support pending upstream).

### 3. TypeScript config updates (automatic)

**Issue:** Next.js 16 requires `jsx: "react-jsx"` and includes dev route types.

**Fix:** Applied automatically during `next build` — no manual edits beyond accepting the generated `tsconfig.json` diff.

### 4. Build output changes (informational)

- Next.js 16 uses Turbopack by default for `next dev` and `next build`
- Build output no longer shows `size` / `First Load JS` metrics
- Edge runtime warning on `/opengraph-image` (pre-existing behavior, unchanged)

## Manual changes made

1. Added `"engines": { "node": ">=20.9.0" }` to `package.json`
2. Downgraded ESLint from 10.x to 9.x after lint failure (see above)
3. No changes to try-on prompt, OpenAI request shape, or UI components

## Remaining warnings

### ESLint (3 warnings, 0 errors)

| File | Rule | Notes |
|------|------|-------|
| `components/Uploader.tsx:18` | `@typescript-eslint/no-unused-vars` | Pre-existing unused `id` prop |
| `components/Uploader.tsx:84` | `@next/next/no-img-element` | Intentional — preview uses object URLs / base64 |
| `postcss.config.mjs:1` | `import/no-anonymous-default-export` | Pre-existing config style |

### Build

- `⚠ Using edge runtime on a page currently disables static generation for that page` — `/opengraph-image` (expected)

## Verification results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **Pass** |
| `npm run lint` | **Pass** (3 warnings, 0 errors) |
| Tests | **N/A** — no test suite in project |
| `npm run build` | **Pass** (Next.js 16.2.11, Turbopack) |
| `npm run dev` | **Pass** — app ready at http://localhost:3000 |
| Homepage | **Pass** — HTTP 200; marketing UI, try-on section, upload controls rendered |
| Person image upload (API) | **Pass** — multipart `person` field accepted |
| Garment image upload (API) | **Pass** — multipart `item` field accepted |
| Missing-image validation | **Pass** — `400` with `"Please provide both your photo and an item image."` |
| Try-on generation (OpenAI) | **Partial** — request reached OpenAI (~8.6s); 1×1 px test PNGs returned `502` / `"The model did not return an image"` (expected for invalid inputs). Full end-to-end image rendering with real photos was **not** verified in this session. |
| Generated result rendering | **Not verified** — requires a successful model response with real person/garment photos |

### What could not be fully tested

- Browser-based drag-and-drop upload UX (verified via rendered HTML + API, not interactive browser session)
- End-to-end try-on with real person/garment photos and result image display (OpenAI key is configured; automated test used minimal 1×1 PNG placeholders)

## Environment requirements

No new environment variables. Existing vars unchanged:

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL` (default `gpt-5.6`)
- `OPENAI_IMAGE_QUALITY` (default `medium`)
- `OPENAI_VISION_DETAIL` (default `low`)
- `NEXT_PUBLIC_SITE_URL`

## Rollback instructions

To revert to the pre-upgrade state:

```bash
git checkout d353648 -- package.json package-lock.json tsconfig.json
git checkout d353648 -- app components lib next.config.mjs postcss.config.mjs tailwind.config.ts
rm -f eslint.config.mjs
npm install
```

Or reset the branch to the checkpoint commit (discards all post-checkpoint work):

```bash
git reset --hard d353648
npm install
```

Then confirm Node.js ≥ 20.9.0 is not required for Next.js 14 (Node 18+ was sufficient for 14.x).

## Next steps (not in Phase 0.5)

- Phase 1: Supabase foundation (per `docs/saas-architecture.md`)
- Re-bump ESLint to 10.x when `eslint-config-next` ships compatible `eslint-plugin-react`
- Optional: add `"typecheck": "tsc --noEmit"` script for CI

## Temporary image optimizer mitigation

Next.js 16.2.11 installs **sharp 0.34.5** as an optional dependency for its built-in image optimizer (`/_next/image`). That version is flagged by [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) until sharp ≥ 0.35.0 ships with a compatible Next.js release.

Dekhlo does **not** use `next/image` or the built-in optimizer. Upload previews use standard `<img>` elements with object URLs or base64; try-on images are sent to OpenAI without local Sharp processing.

To reduce accidental use of the vulnerable optimizer path, `next.config.mjs` sets:

```js
images: {
  unoptimized: true,
},
```

**Notes:**

- `npm audit --omit=dev` may still report sharp because the optional dependency remains installed.
- Do **not** remove this setting until Next.js ships with a compatible patched sharp version, or image optimization is moved to a trusted external service.
- Adding `next/image`, local Sharp processing, or server-side image resizing requires immediate security reassessment.

See also: `docs/supabase-phase-1.md` — **Known upstream dependency advisories**.
