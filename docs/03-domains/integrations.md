# Integrations

## Model

`integrations` represents durable external-service connections.

| Field | Notes |
|---|---|
| `key` | Stable identifier, unique, lowercase alphanumeric + hyphens |
| `type` | Integration type (e.g. `email-marketing`, `external`) |
| `name` | Display name |
| `status` | `active` / `disabled` |
| `config` | Public, non-secret configuration (JSON) |
| `encrypted_secrets` | Secret values, AES-256-GCM encrypted at rest |

## Secret Handling

- Secrets are **encrypted at rest** using `@vibress/security` secret
  encryption (master key from `VIBRESS_ENCRYPTION_KEY`).
- **Masked on read** — the admin DTO shows `••••••••` for every secret key;
  raw values are never returned by APIs.
- **Replace-only on update** — updating an integration without providing a
  secret keeps the existing encrypted value; empty values never overwrite.
- Secrets are never logged, never stored in audit payloads, and never exposed
  in error messages.

## Lifecycle

Create → update (name/status/config/secrets) → disable. No hard deletion of
integrations referenced by API keys.

## Admin

- `integrations.read` — list integrations (masked secrets).
- `integrations.manage` — create/update.
- Unauthenticated → 401; authenticated without permission → 403.

## API Keys

Machine credentials, fully separate from Staff/Member sessions.

| Field | Notes |
|---|---|
| `prefix` | Visible identifier (`vk_<8 hex>`), never a secret |
| `key_hash` | SHA-256 of the full raw secret — **raw secret never stored** |
| `scopes` | Explicit permission list (e.g. `content.read`, `webhooks.register`) |
| `expires_at` | Optional expiry |
| `revoked_at` | Set on revocation |
| `last_used_at` | Updated on successful authentication |

- The raw secret (`vk_<prefix-part>_<secret-part>`) is returned **exactly
  once** at creation.
- Authentication: `Authorization: Bearer <secret>` → hash → lookup → reject
  revoked/expired → return scopes. Unknown/revoked/expired all produce the
  same generic `401` (no enumeration).
- Scope enforcement returns `403 SCOPE_DENIED` for keys without the required
  scope.
- Machine endpoints live under `/api/machine/v1` — never require staff or
  member cookies.
