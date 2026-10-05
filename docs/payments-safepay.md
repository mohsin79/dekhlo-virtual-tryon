# Safepay credit packs

Merchants buy one-time try-on credit packs in PKR. Pakistan-only. There is no subscription and no Stripe integration. Stripe is not available for this Pakistani business.

Credits are added only after Dekhlo confirms the payment with Safepay's API. The browser return URL is not proof of payment. A repeated webhook or a refreshed success page uses the existing `grant_brand_credits` RPC and the order's idempotency key, so the same purchase cannot add credits twice.

Pack names, credit amounts, and PKR prices live in `lib/payments/credit-packs.ts`. **The prices in that file are placeholders**, not a live tariff. Change them before a real merchant is charged.

## What this follows

Merchant hosted checkout, not the Raast aggregator API:

- Express Checkout guide: <https://safepay-docs.netlify.app/build-your-integration/express-checkout/>
- Tracker states (`TRACKER_ENDED` means paid): <https://safepay-docs.netlify.app/concepts/tracker-states/>
- `@sfpy/node-core` 0.3.5 request paths and checkout URL shape (`POST /order/payments/v3/`, `POST /client/passport/v1/token`, `GET /reporter/api/v1/payments/{tracker}`, checkout host `/embedded/`). Dekhlo calls those endpoints directly so tests can mock HTTP without the SDK's axios client.
- Auth header `X-SFPY-MERCHANT-SECRET`: `@sfpy/node-core` `RequestSender`.
- Webhook signature: HMAC-SHA512 of the **raw** body, hex digest, header `X-SFPY-SIGNATURE`. This matches the official PHP SDK (`Safepay\WebhookSignature` in [getsafepay/sfpy-php](https://github.com/getsafepay/sfpy-php)) and `@sfpy/node-sdk` `verify.webhook`, with the Payments 2.0 correction that the signature covers the whole body ([getsafepay/safepay-node#28](https://github.com/getsafepay/safepay-node/issues/28)). The dashboard shared secret is the HMAC key as UTF-8. Do not base64-decode it. That base64 step belongs to Safepay's separate Raast aggregator webhooks (<https://safepay.mintlify.app/guides/webhooks-delivery>), which this checkout does not use.
- Sandbox test card and 3-D Secure emulator: <https://safepay.helpscoutdocs.com/article/41-dummy-card-information> and <https://safepay.helpscoutdocs.com/article/82-testing-the-latest-safepay-checkout-integration>.
- API keys in the dashboard: sandbox <https://sandbox.api.getsafepay.com/dashboard/developers/api>, production <https://getsafepay.com/dashboard/developers/api> (linked from the `@sfpy/node-core` readme).

The hosted page offers the methods enabled on the Safepay account (cards, wallets, and Raast when Safepay has turned them on). Dekhlo does not collect card numbers.

The payment-session `metadata` sent to Safepay is only `order_id`, the `credit_pack_orders` id. Safepay's sandbox rejects any other metadata key (a 500 with `unsupported meta key`). The brand and the pack stay on that order row. The webhook and the success or cancel page load the row by tracker or order id and do not read `brand_id` or `pack_id` back from Safepay. If Safepay refuses to open checkout, the server log records the HTTP status and a short redacted response snippet. Secrets are not written to that log.

## Environment variables

All of these are server-only. Put them in the host's environment (Vercel project env, or `.env.local` for local work). Do not prefix them with `NEXT_PUBLIC_`.

| Variable | Sandbox value | Production value |
| --- | --- | --- |
| `SAFEPAY_ENVIRONMENT` | `sandbox` | `production` |
| `SAFEPAY_API_KEY` | Merchant **public** API key from the sandbox Developer → API page | The live public API key from the production Developer → API page |
| `SAFEPAY_SECRET_KEY` | Merchant **secret** from that same sandbox API page. Sent as `X-SFPY-MERCHANT-SECRET` | The live merchant secret |
| `SAFEPAY_WEBHOOK_SECRET` | **View shared secret** on the sandbox endpoint you create below | The live endpoint's shared secret |
| `SAFEPAY_PAYMENT_INTENT` | Optional. Leave unset (`CYBERSOURCE`). Set `MPGS` only if Safepay tells you that channel is the one enabled on the account | Same |
| `NEXT_PUBLIC_SITE_URL` | Public origin shoppers return to, with no trailing slash. For the protected preview alias: `https://dekhlo-virtual-tryon-preview.vercel.app` | The production origin |

`SAFEPAY_ENVIRONMENT=sandbox` uses `https://sandbox.api.getsafepay.com` for the API and `https://sandbox.api.getsafepay.com/embedded/` for hosted checkout. `production` uses `https://api.getsafepay.com` for the API and `https://getsafepay.com/embedded/` for checkout. Sandbox keys and the production switch are different Safepay accounts. Do not mix them.

Only a sandbox account exists today. Leave `SAFEPAY_ENVIRONMENT=sandbox` until live keys are issued.

## Webhook URL to register

In the **sandbox** Safepay dashboard open **Developer → Endpoints → Add an endpoint**.

Register:

`https://dekhlo-virtual-tryon-preview.vercel.app/api/payments/safepay/webhook`

Subscribe that endpoint to `payment.succeeded` and `payment.failed`. Open the endpoint, choose **View shared secret**, and put that value in `SAFEPAY_WEBHOOK_SECRET`.

Local `http://localhost:3000` is not a public webhook URL. The success page still confirms the tracker with Safepay's API when the browser returns, so a sandbox purchase can grant credits without a webhook. The webhook is what grants credits if the shopper never lands back on the success page. For a local webhook test, use a tunnel and register that HTTPS URL in the sandbox dashboard instead.

### Vercel Deployment Protection

The preview alias is behind Vercel Deployment Protection. Safepay's webhook is a plain HTTPS POST. It will receive the protection challenge and never reach this route unless the request bypasses protection.

That is the same class of problem Inngest has on this preview. Inngest can send the bypass as a request header. Safepay's endpoint form only accepts a URL, so it cannot set `x-vercel-protection-bypass`.

Vercel also accepts that secret as a query parameter, which is the method it documents for webhooks that cannot set headers: <https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation>.

When you register the endpoint in Safepay, append the preview project's automation bypass secret:

`https://dekhlo-virtual-tryon-preview.vercel.app/api/payments/safepay/webhook?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>`

Copy `<VERCEL_AUTOMATION_BYPASS_SECRET>` from the Vercel project (Protection Bypass for Automation). Vercel injects the same value as `VERCEL_AUTOMATION_BYPASS_SECRET` on deployments. **Do not commit it, do not put it in `.env.example`, and do not paste it into this repo.** The signature Safepay sends is over the raw body, so the query string does not change verification.

A production domain that is not behind Deployment Protection uses the bare path `/api/payments/safepay/webhook` and the live endpoint secret.

## Sandbox purchase

1. Set the sandbox variables above and `NEXT_PUBLIC_SITE_URL` to the origin you will use (preview alias or `http://localhost:3000`).
2. Sign in as a brand **owner** or **admin** and open **Dashboard → Credits**.
3. Choose a pack. The button sends you to Safepay hosted checkout. Prices on the page are the placeholders in `lib/payments/credit-packs.ts`.
4. Pay with Safepay's sandbox dummy Visa card from their [dummy card article](https://safepay.helpscoutdocs.com/article/41-dummy-card-information): number `5200 0000 0000 1096`, expiry `03/28`, CVC `111`. Use any sandbox billing name and a Pakistan address. Do not use a real card. Complete the sandbox 3-D Secure emulator as a successful authentication ([testing article](https://safepay.helpscoutdocs.com/article/82-testing-the-latest-safepay-checkout-integration)).
5. Safepay redirects to `/dashboard/credits/checkout/success/<orderId>`. That page calls `GET /reporter/api/v1/payments/{tracker}` and grants credits only when `tracker.state` is `TRACKER_ENDED`, `tracker.client` is this account's public API key, and the PKR amount matches the order. The same confirmation runs from the webhook.
6. The credits page balance increases once. Refreshing the success page, or delivering the webhook again, does not add the pack a second time.
7. Cancel from the hosted page to land on `/dashboard/credits/checkout/cancel/<orderId>`. A cancelled or unfinished tracker does not add credits. If Safepay has already captured the payment, that page still grants them.

Sandbox payments are visible in the Safepay dashboard under **Payments → Payments 2.0**.

Refunds, disputes, and voided trackers do not claw credits back in this version. They also do not grant credits if the order was not already paid.

## Roles and data

Owners and admins can start checkout. Analysts can read the balance, ledger, and pack orders. Editors cannot. Row level security matches the credit tables: authenticated finance roles can `SELECT` their brand's `credit_pack_orders` rows and cannot insert or update them. The service role writes orders and calls `grant_brand_credits`.
