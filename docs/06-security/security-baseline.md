# Security Baseline

Security is a platform responsibility.

## Authentication

Supported identities may include:

- staff sessions
- API keys
- integration keys
- member sessions/tokens
- one-time login links
- optional MFA

## Authorization

Use explicit permissions:

```text
posts.read
posts.create
posts.edit
posts.publish
posts.delete
members.read
members.edit
settings.read
settings.edit
```

Avoid role checks such as `role === "admin"` scattered through business code.

## Session security

For browser sessions:

- `HttpOnly`
- `Secure`
- strict/safe `SameSite`
- rotation on privilege elevation
- revocation support
- expiry and inactivity policies

## CSRF

State-changing cookie-authenticated requests require CSRF protection using a validated Origin/Referer strategy or anti-CSRF tokens.

## Rate limiting

Protect at minimum:

- login
- password reset
- one-time token flows
- member login
- public search
- comments
- webhooks
- expensive exports
- upload initialization

## SSRF

All server-side outbound HTTP requests must use a single hardened client that:

- blocks private/reserved IP ranges
- validates redirects
- resolves DNS safely
- defends against DNS rebinding
- applies timeout and response-size limits

## XSS

- Treat editor HTML as untrusted until rendered through controlled serializers/sanitizers.
- Sanitize raw HTML cards.
- Avoid uncontrolled `dangerouslySetInnerHTML`.
- Use CSP where practical.

## Uploads

Validate:

- file size
- extension
- actual MIME/content
- image parsing
- SVG sanitization
- archive safety
- filename/path normalization

## Secrets

External credentials are encrypted at rest using a master key supplied outside the database.

Example:

```text
VIBRESS_ENCRYPTION_KEY
```

The master key must not be stored in the same database as encrypted secrets.

### Key rotation

Encrypted rows (`webhook_endpoints.secret_encrypted`, storage configuration
credentials) are AES-256-GCM sealed under the current key. Rotating
`VIBRESS_ENCRYPTION_KEY` orphans existing ciphertext. Rotation must be a
coordinated re-encryption:

1. Generate a new key (`openssl rand -hex 32`).
2. Decrypt each stored payload with the current key, re-encrypt with the new
   key, write back (within a transaction), then swap the env var.
3. Keep the previous key available until every encrypted value has migrated.

For development, `scripts/` must never hardcode a real key; the workspace
`.env` key is gitignored and is regenerated from `.env.example` placeholder,
never shipped.
