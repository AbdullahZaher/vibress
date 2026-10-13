# Settings

## Architecture

Typed, namespaced schemas — never an untyped key/value dump. Each namespace
(`site`, `publishing`, `members`, `email`, `billing`, `storage`,
`integrations`, `security`) defines typed settings with validation rules.
The Settings domain orchestrates persistence, validation, and API exposure;
each domain owns the meaning of its settings.

## Classification

Every setting is explicitly classified:

| Classification  | Visibility                                            |
| --------------- | ----------------------------------------------------- |
| `public`        | Exposed via the public settings endpoint              |
| `staff-visible` | Exposed to staff (masked never applied)               |
| `secret`        | Masked as `••••••••` for staff; never logged/exported |
| `internal`      | Masked as `••••••••`; never exposed/exported          |

Public APIs never leak staff/internal/secret values. Secret provider
credentials continue using encrypted secret storage (integrations domain),
not ordinary settings JSON.

## Changes

- Values are validated (type coercion + schema validators) before persistence.
- Every change records an audit entry (`setting.updated`) with the
  classification — never with the raw value.
- Raw secret values are never logged or returned.

## Publication ownership (migration 0033)

Settings are now keyed by `(publication_id, namespace, key)`, with a foreign key to the owning publication. All reads, updates and deletes at the repository level require a publication scope; compatibility callers without an explicit scope use `pub_default`, and public/staff HTTP routes always resolve it authoritatively from the hostname or the permission-checked staff session.

Migration 0033 is additive and transactional. It retains original setting IDs for `pub_default`, duplicates the previously shared settings for publications existing at upgrade time (including code and privacy settings), and does not rewrite or discard stored values. Publications created later start with setting-schema defaults. Operators should review site code and shared integration credentials after upgrading multi-publication installations: the earlier global state was already visible to all existing publications, and the migration preserves that historical behavior.

Secret and internal setting values remain masked in staff/public responses. Public site identities, navigation, announcements, analytics, code snippets and privacy flags are read from the host-resolved publication. If no publication maps to the request hostname in production, public settings routes return 404 rather than reading `pub_default` settings.

The existing API JSON envelopes, setting names, types, and update bodies are unchanged. Runtime validation and `settings.manage`/`settings.read` permissions remain in force.
