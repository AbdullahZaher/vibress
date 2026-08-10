# Settings

## Architecture

Typed, namespaced schemas — never an untyped key/value dump. Each namespace
(`site`, `publishing`, `members`, `email`, `billing`, `storage`,
`integrations`, `security`) defines typed settings with validation rules.
The Settings domain orchestrates persistence, validation, and API exposure;
each domain owns the meaning of its settings.

## Classification

Every setting is explicitly classified:

| Classification | Visibility |
|---|---|
| `public` | Exposed via the public settings endpoint |
| `staff-visible` | Exposed to staff (masked never applied) |
| `secret` | Masked as `••••••••` for staff; never logged/exported |
| `internal` | Masked as `••••••••`; never exposed/exported |

Public APIs never leak staff/internal/secret values. Secret provider
credentials continue using encrypted secret storage (integrations domain),
not ordinary settings JSON.

## Changes

- Values are validated (type coercion + schema validators) before persistence.
- Every change records an audit entry (`setting.updated`) with the
  classification — never with the raw value.
- Raw secret values are never logged or returned.
