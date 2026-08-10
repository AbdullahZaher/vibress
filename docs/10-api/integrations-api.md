# Integrations & Platform API

## Admin (staff, RBAC)

| Method | Path | Permission |
|---|---|---|
| GET | `/api/admin/v1/integrations` | `integrations.read` |
| POST | `/api/admin/v1/integrations` | `integrations.manage` |
| PATCH | `/api/admin/v1/integrations/:id` | `integrations.manage` |
| GET | `/api/admin/v1/api-keys` | `api_keys.read` |
| POST | `/api/admin/v1/api-keys` | `api_keys.manage` |
| POST | `/api/admin/v1/api-keys/:id/revoke` | `api_keys.manage` |
| GET | `/api/admin/v1/webhook-endpoints` | `webhooks.read` |
| POST | `/api/admin/v1/webhook-endpoints` | `webhooks.manage` |
| PATCH | `/api/admin/v1/webhook-endpoints/:id` | `webhooks.manage` |
| DELETE | `/api/admin/v1/webhook-endpoints/:id` | `webhooks.manage` |
| GET | `/api/admin/v1/webhook-deliveries` | `webhooks.read` |
| GET | `/api/admin/v1/plugins` | `plugins.read` |
| POST | `/api/admin/v1/plugins/register` | `plugins.manage` |
| POST | `/api/admin/v1/plugins/:id/activate` | `plugins.manage` |
| POST | `/api/admin/v1/plugins/:id/deactivate` | `plugins.manage` |
| POST | `/api/admin/v1/plugins/:id/settings` | `plugins.manage` |
| GET | `/api/admin/v1/plugins/:id/settings` | `plugins.read` |
| DELETE | `/api/admin/v1/plugins/:id` | `plugins.manage` |

## Machine (API key auth, no cookies)

| Method | Path | Scope |
|---|---|---|
| GET | `/api/machine/v1/status` | any valid key |
| POST | `/api/machine/v1/events` | `content.read` |

- Missing/invalid/revoked/expired key → generic `401`.
- Key without required scope → `403 SCOPE_DENIED`.

## DTO Masking

- Integrations: `secrets` returned as `••••••••` per key.
- API keys: `prefix` only; raw secret returned once at creation.
- Webhook endpoints: `hasSecret` boolean only.
- Plugin settings: secret values masked.
