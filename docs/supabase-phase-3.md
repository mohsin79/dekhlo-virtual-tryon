# Supabase Phase 3 — Authentication and Onboarding

Phase 3 adds email/password authentication, email confirmation handling, atomic brand onboarding, and a protected merchant dashboard shell. This document covers **manual Supabase Auth configuration** that must be completed in the Supabase Dashboard. These settings are **not** applied automatically by the repository.

## Prerequisites

- Phase 1 linked project and client utilities
- Phase 2 tenant schema, RLS, and profile trigger deployed
- Phase 3 migration `create_brand_with_owner` deployed
- `NEXT_PUBLIC_SITE_URL` set in your environment (see `.env.example`)

## Local development defaults

### Site URL

```
http://localhost:3000
```

Set this under **Authentication → URL Configuration → Site URL** for local Supabase or your hosted project's development environment.

### Redirect URL

Add this allow-listed redirect URL:

```
http://localhost:3000/auth/confirm
```

Supabase sends confirmation and recovery links to this route. The application validates tokens server-side and writes session cookies through the SSR client.

## Email confirmation template

Hosted Supabase projects enable email confirmation by default unless changed. Local Supabase may behave differently depending on your `config.toml` settings.

Update the **Confirm signup** email template to use the SSR token-hash flow:

```html
<h2>Confirm your email</h2>
<p>Follow this link to confirm your Dekhlo account:</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">
    Confirm email
  </a>
</p>
```

Required query parameters:

- `token_hash={{ .TokenHash }}`
- `type=email`
- `/auth/confirm` as the callback path
- optional `next=/onboarding` for post-confirmation routing

## Password recovery template

Update the **Reset password** email template:

```html
<h2>Reset password</h2>
<p>Follow this link to reset your Dekhlo password:</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password">
    Reset password
  </a>
</p>
```

Required query parameters:

- `token_hash={{ .TokenHash }}`
- `type=recovery`
- `/auth/confirm` as the callback path
- `next=/auth/reset-password` so recovery sessions reach the reset form

## Production and preview deployments

Before production launch:

1. Change **Site URL** to your production domain (for example `https://app.dekhlo.pk`).
2. Explicitly allow-list every production and preview redirect URL that will receive auth callbacks.
3. Treat preview deployment URLs separately — each preview origin that handles auth must be allow-listed if used for sign-up or password reset testing.

## Email delivery notes

- Custom SMTP is deferred in Phase 3 but **required before serious production use**.
- Supabase default / test email delivery is **not** a production email solution.
- Local development can use Supabase Mailpit when running `supabase start`.

## Security reminders

- Never commit real passwords, tokens, API keys, or service role secrets.
- Do not paste live confirmation links into tickets or chat.
- The application uses `NEXT_PUBLIC_SITE_URL` for auth redirect construction — do not rely on untrusted `Host` headers.

## Application routes added in Phase 3

| Route | Purpose |
| --- | --- |
| `/auth/login` | Email/password sign in |
| `/auth/sign-up` | Account registration |
| `/auth/forgot-password` | Request password reset email |
| `/auth/reset-password` | Set a new password (recovery session) |
| `/auth/confirm` | Server-side OTP/code confirmation handler |
| `/auth/error` | Invalid or expired auth link messaging |
| `/onboarding` | Atomic brand creation for new merchants |
| `/dashboard` | Protected merchant shell |

## Database RPC

Phase 3 exposes:

```sql
public.create_brand_with_owner(p_name text, p_slug text) returns uuid
```

- Callable only by the `authenticated` role
- Uses `auth.uid()` internally — never accepts a caller-supplied owner ID
- Atomically inserts `brands` and the initial `owner` membership

## What Phase 3 does not include

Products, storage buckets, credits, billing, team invitations, analytics, and public merchant try-on routes remain out of scope until later phases.
