# Remote What's New Notification System

The **What's New** notification system displays product updates and feature announcements in the bottom-left area of the Vibress Admin sidebar.

Notifications are remotely managed via a JSON feed hosted in the canonical Vibress repository. Changing or publishing announcements does not require deploying the Admin application.

---

## 1. Remote Feed Location

The canonical feed is located at:

```text
.github/whats-new.json
```

Public raw URL:

```text
https://raw.githubusercontent.com/AbdullahZaher/vibress/main/.github/whats-new.json
```

---

## 2. Feed Schema & Example

```json
{
  "version": 1,
  "items": [
    {
      "id": "analytics-email-sequences",
      "title": "Analytics for email sequences",
      "description": "Understand how your automated emails are performing.",
      "icon": "sparkles",
      "url": "/admin/analytics/email-sequences",
      "publishedAt": "2026-09-13T00:00:00Z",
      "minVersion": "1.0.0",
      "maxVersion": "2.0.0"
    }
  ]
}
```

### Fields Specification

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | **Yes** | Unique, stable identifier (used as the permanent dismissal key). |
| `title` | `string` | **Yes** | Headline rendered as plain text. |
| `description` | `string` | **Yes** | Body text rendered as plain text. |
| `publishedAt` | `string` | **Yes** | ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ssZ`). |
| `icon` | `string` | No | Safe icon key (`sparkles`, `bell`, `zap`, `info`, `star`, `rocket`). Defaults to `sparkles`. |
| `url` | `string` | No | Safe navigation target (`/admin/...` relative path or HTTPS URL). |
| `minVersion` | `string` | No | Minimum compatible SemVer version (e.g. `1.0.0`). |
| `maxVersion` | `string` | No | Maximum compatible SemVer version (e.g. `2.0.0`). |

---

## 3. Selection & Single Item Rule

The Admin sidebar displays **strictly ONE notification at a time**.

Selection algorithm:
1. Fetch and schema-validate the remote feed.
2. Filter out future-dated items (`publishedAt > now`).
3. Filter out items incompatible with the active Vibress system version (`minVersion` / `maxVersion`).
4. Filter out items already dismissed by the current authenticated user.
5. Sort remaining eligible items by `publishedAt DESC` (newest first), using `id ASC` as a deterministic tie-breaker.
6. Render the first eligible item. If none remain, the component renders `null` (no empty container or placeholder).

---

## 4. Permanent Dismissal Semantics

When an authenticated user clicks the **X** close button:
- The notification card is immediately hidden in the UI.
- The notification's `id` is persisted to the user's account preferences in the Vibress database.
- The dismissal is **permanent** for that user account across all devices, browsers, and sessions.
- Dismissing one notification does not prevent future notifications with **different IDs** from appearing.

> [!IMPORTANT]
> **Maintainer Rule:** Never reuse an old notification `id` for a materially different feature announcement. Because dismissal is permanently keyed on `id`, users who dismissed the previous announcement will not see the new one if the `id` is reused. Always assign a fresh, descriptive `id` (e.g. `analytics-email-sequences`, `custom-domains-v2`).

---

## 5. Server-Side Caching & Fault Tolerance

- **Caching:** The Vibress API caches the feed in-memory with a **1-hour TTL (3,600s)** to minimize external GitHub network requests.
- **SSRF Protection:** Remote requests use `@vibress/security` `safeFetch` with a 5-second timeout and DNS rebinding protections.
- **Stale Fallback:** If GitHub is temporarily unavailable, the API serves the previously cached feed.
- **Total Failure:** If no cache exists and GitHub is unavailable, the API returns `{ item: null, items: [] }` with HTTP 200, ensuring the Admin interface remains completely functional.
