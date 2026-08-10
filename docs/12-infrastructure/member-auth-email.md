# Member Auth Email (Transactional)

## Scope

Batch 8 delivers only **transactional member-authentication email**: the passwordless magic-link message. Newsletter, marketing, and email-product functionality belong to a later batch (Batch 10).

## Architecture

```
Members domain (MemberAuthMailer interface)
        ↓
SmtpMemberAuthMailer (apps/api/src/mailer)
        ↓
SMTP (dev: Mailpit on 127.0.0.1:1025)
```

The Members domain depends only on the `MemberAuthMailer` interface — not on Nodemailer or SMTP specifics.

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `SMTP_HOST` | `127.0.0.1` | SMTP host |
| `SMTP_PORT` | `1025` | SMTP port (Mailpit dev) |
| `SMTP_USER` / `SMTP_PASSWORD` | — | optional auth |
| `SMTP_FROM` | `Vibress <no-reply@vibress.local>` | from address |
| `PORTAL_URL` / `SITE_URL` | `http://localhost:7777` | trusted base for magic links |

## Magic Link URL

Built from trusted config — never the request `Host` header. Format:

```
{portalBase}/portal/auth/verify?token=<opaque>
```

## Delivery Failure

`sendMagicLink` throwing results in `MAIL_DELIVERY_FAILED`:
- Client receives the same generic enumeration-safe response.
- No authenticated session is created.
- The short-lived token expires quickly; failure is logged without the token.

## Development / Test

Mailpit is available at `127.0.0.1:1025` (SMTP) and `http://127.0.0.1:8025` (web/API). E2E tests retrieve the magic link from the Mailpit API, never from application logs.
