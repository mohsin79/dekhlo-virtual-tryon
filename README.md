# Dekhlo — Virtual Try-On for Pakistani Fashion

_Dekh lo, phir socho._ See how a style might look on you before you decide.

Dekhlo is an AI virtual try-on for Pakistani fashion — shalwar kameez, abayas, bridal, formal and western wear. Users drop **their photo** and **an outfit** (a flat product shot or a model wearing it), tap **Try this on**, and get a photorealistic style preview. The product is honest by design: it previews the *style*, not a guaranteed physical fit.

## Stack & why

- **Next.js 14 (App Router) + React 18 + TypeScript** — server-rendered marketing copy and a first-class **SEO** story: the Metadata API (title template, OpenGraph, Twitter, canonical), `sitemap.ts`, `robots.ts`, a PWA `manifest.ts`, JSON-LD structured data, and a generated `opengraph-image`. Great for **branding** (custom domain, OG cards, installable PWA) and easy one-click deploys.
- **Tailwind CSS** for layout, over the **Organic design system** tokens (warm cream ground, terracotta + sage accents, Caprasimo/Figtree type) ported into `app/globals.css`.
- **OpenAI Responses API** — chat model (`gpt-5.6`) with the `image_generation` tool, matching the ChatGPT virtual try-on flow. Works for clothing, accessories, makeup, and more.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

### Environment

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | **Required.** Server-side key for the try-on route. |
| `OPENAI_CHAT_MODEL` | Optional. Defaults to `gpt-5.6`. Use `gpt-4.1-mini` after org verification for lower cost. |
| `OPENAI_IMAGE_QUALITY` | Optional. `medium` (default), `high`, `low`, or `auto`. |
| `OPENAI_VISION_DETAIL` | Optional. `low` (default) or `high` for upload analysis. |
| `NEXT_PUBLIC_SITE_URL` | Your production URL — feeds canonical URLs, sitemap, robots, OG tags. |

## How the try-on works

`POST /api/try-on` (multipart) with `person` and `item` image files →
the route sends both images plus the virtual try-on prompt to `openai.responses.create`
with the `image_generation` tool (same approach as ChatGPT), and returns
`{ image: "data:image/png;base64,…" }`. The client shows it side-by-side
with the chosen item and the honest "style, not fit" note.

- Runs on the Node runtime; `maxDuration` is 180s.
- Images are capped at 8MB each and never stored server-side.
- Tune the prompt in `lib/try-on-prompt.ts`.

## Project structure

```
app/
  layout.tsx          Fonts, metadata, JSON-LD
  page.tsx            Server-rendered hero + <TryOnStudio/>
  globals.css         Organic tokens + component layer
  sitemap.ts robots.ts manifest.ts opengraph-image.tsx icon.svg
  api/try-on/route.ts OpenAI image generation
components/
  TryOnStudio.tsx     Client: uploads, generate, result, actions
  Uploader.tsx        Drag-and-drop image input with preview
  Logo.tsx
lib/site.ts           Brand + SEO config (single source of truth)
```

## Deploy

Deploy to **Vercel** (recommended for Next.js): set the three env vars in the project settings and point your domain (e.g. `dekhlo.pk`). `output` is the default Node server so the OpenAI route runs as a serverless function.

## Next steps / ideas

- Saved looks gallery (persist to a DB + auth).
- Rate limiting on `/api/try-on` (e.g. Upstash) before launch.
- Per-brand outfit catalog so users pick instead of upload.
- Multiple angles / colour variations per generation.
