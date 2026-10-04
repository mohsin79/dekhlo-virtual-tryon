# Dekhlo — Virtual Try-On for Pakistani Fashion

_Dekh lo, phir socho._ See how a style might look on you before you decide.

Dekhlo is a multi-tenant virtual try-on for Pakistani fashion brands. Merchants publish a catalog, share a public try-on link for each active product, and shoppers upload only their photo. Customer photos and results stay private. Credits are reserved only after a photo upload is validated.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**
- **Supabase** for auth, Postgres row level security, and storage
- **OpenAI Responses API** for generation. The try-on prompt and model settings are preserved.
- **Inngest** for background generation and retention cleanup
- **Upstash Redis** for rate limits

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set every required value in `.env.local`. Do not commit `.env.local` or `.env.production`. `.env.example` lists the variable names and which ones are server-only.

## Routes

| Route | Who |
| --- | --- |
| `/` | Marketing |
| `/demo` | Rate-limited two-image demo. Does not spend merchant credits. |
| `/try/[brandSlug]/[productSlug]` | Public product try-on. Person photo only. |
| `/auth/*` | Merchant sign-in, sign-up, and password reset |
| `/onboarding` | First brand for a new merchant |
| `/dashboard` | Products, leads, and credits |
| `/platform` | Platform admin credit operations |

Email confirmation and password-reset links open `/auth/confirm` and wait for an explicit click before the token is used.

## Tests

```bash
npm run test:unit
```
