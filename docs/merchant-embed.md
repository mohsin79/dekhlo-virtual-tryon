# Merchant embed

A store can run the same product try-on on its own product page. The shopper stays on that page. The person photo, catalog garment, session, credits, and generation stay on Dekhlo.

Phase 9 in `docs/saas-architecture.md` names billing and a custom domain beside this embed. Billing is Safepay credit packs ([`docs/payments-safepay.md`](payments-safepay.md)). A custom domain is still future work. Neither is part of this embed. Phase 8C left framing unset until this model existed: only the embed document may be framed, and the dashboard, auth, and standalone try-on page send `X-Frame-Options: DENY`.

## Where the snippet comes from

1. Sign in and open **Dashboard → Products**.
2. On an **active** product, copy **Embed on your product page**.
3. Paste that snippet into the store's product template, where the try-on should appear.

Inactive products do not get a snippet. The public link on the same card is unchanged: `/try/[brandSlug]/[productSlug]`.

The dashboard copies an iframe plus a short script. The script listens for a `dekhlo:embed-resize` message and sets the frame height. That message is only a type and a number. It does not include the session token, the photo, or the result. The frame starts at 960px and grows to the try-on, so the result heading and image are not clipped inside the frame.

Replace the host and slugs with the values from the dashboard. The slugs are the same ones in the public try-on link.

Stores that would rather paste a script can use the loader. It creates the same iframe and grows it from the same height message. It does not read the store page or call the try-on API:

```html
<script src="https://YOUR-DEKHLO-HOST/embed/loader" data-brand="BRAND-SLUG" data-product="PRODUCT-SLUG" async></script>
```

## What the shopper does

The frame is the product try-on: one person photo, the catalog garment, optional storage consent, then generation. Credits are still reserved only after the upload is validated, through the existing session API and credit RPCs. The OpenAI prompt and generation path are unchanged.

The host page cannot read the frame. It does not receive the session token, the upload, or the result image. Do not add `sandbox` to the iframe. A sandboxed frame without the embed's own origin cannot call the session API.

## Why this is an iframe

The session credential is an HttpOnly, SameSite=Lax cookie. Browsers will not send that cookie from a store's origin, and the session API rejects cross-origin requests. Loosening the cookie or the origin check would weaken every try-on, including the standalone page.

The embed document lives on Dekhlo (`/embed/[brandSlug]/[productSlug]`), so its calls to `/api/try-on/sessions` are same-origin. When the Lax cookie is not stored, the frame keeps the same session token in its own session storage and sends it as `x-dekhlo-session-token`. That header is ignored when the cookie is present, so it cannot replace a cookie the browser did send. The token is returned in JSON only for a new session whose `Referer` is the embed document. A request from `/try/...`, from `/embed/preview`, or from another host does not receive it.

## Try it locally

```bash
npm run dev
```

Open a stand-in product page. Use the slugs from a real active product:

```text
http://localhost:3000/embed/preview?brand=YOUR-BRAND&product=YOUR-PRODUCT
```

The staging catalog used on 2026-10-04 was `dekhlo-test-brand` and `test-black-t-shirt`. The preview page is not the snippet itself. It is a sample store page with the iframe in it. Completing a try-on still needs the same local services as `/try/...` (Supabase, credits, and Inngest).

Direct frame, same flow:

```text
http://localhost:3000/embed/YOUR-BRAND/YOUR-PRODUCT
```
