# External Plugin SDK — release acceptance gates (2026-10-22)

**Status: PROVISIONAL — do not announce a stable external SDK or an
untrusted ZIP/plugin marketplace.** This document records what needs to
be proven after merging PR #77, not a release sign-off. Existing bundled
plugin compatibility remains supported.

## Runtime and distribution compatibility

| Contract | Current fact | Release gate |
| --- | --- | --- |
| `@vibress/plugin-sdk` | ABI `SDK_VERSION = "1.0.0"`; package `private: true` in this monorepo | Publish a reviewed, independently installable typed SDK and versioned compatibility test |
| External code | Trusted operator-pinned, SHA-256 + optional Ed25519 verified ESM; shared API/Worker preflight | Signatures mandatory in production deployment, artifact scan, multi-replica digest match and rollback |
| Admin iframe | Read-only isolated opaque origin in main; Host-confirmed linked POST proposed in PR #78 | API denial, permission escalation, stale frame, Arabic/RTL, keyboard and CSP E2E |
| Public Web | Host-reserved SSR dispatcher + safe extension theme slot | Two themes, Arabic/English translations, private-site/locale/SEO and cache denial E2E |
| Member API | Authenticated own-member read and existing plan checks; **no generic Member transactional storage** | Authorize and test Member-owned enrollment/progress writes under the Host, never via direct plugin SQL |
| Database | Scoped models and migration catalog; existing LMS SQL remains **candidate** | Independent plugin-owned schema approval, populated upgrade, rollback/restore, concurrent adoption |
| Events | PostgreSQL operator event admission and at-least-once BullMQ dispatch | Transactional domain-event outbox, idempotency and dead-letter recovery under process crash |
| Secrets | AES-256-GCM, publication-scoped revocation, audit | Key-versioned rotation covering **all** existing platform ciphertext, operator proof and rollback |
| Operations | Signed backups + read-only restore compatibility preflight, health/metrics and CI scans | Coordinated PostgreSQL/Redis/artifact restore drill, canary and mixed-version rollout |
| LMS | Independent domain/application code in `AbdullahZaher/vibress-lms` | Deployed and admitted package, real course/lesson/enrollment across two sites and two locales, no core LMS imports |

## Non-negotiable negative tests

1. Unauthorized Staff, Member and anonymous callers cannot read/write another
   publication's data even if they know a valid object ID.
2. Replayed or revoked plugin artifacts cannot execute, including after a
   partial restore or mixed-version replica rollout.
3. Lost database/Redis connections and duplicate deliveries do not bypass
   authorization, grants or idempotency.
4. Legacy global settings, existing encrypted secrets, published content,
   plugin manifests and themes continue working on both fresh and upgraded
   PostgreSQL installations.
5. Keyboard, Arabic/RTL and responsive fallback views have verified E2E
   coverage; HTML or plugin JS never gains a same-origin Admin principal.

The host **does not provide Node process isolation** against a malicious
operator-installed plugin. Treat all such code as trusted operator-reviewed
code until a separately supervised and tested isolation design is adopted.

**Release rule:** Do not freeze SDK vNext, label EXT-501–504 complete, promote
the LMS plugin or advertise production marketplace support before the
specific gates above are evidenced in CI, real database/restore tests and
the operator support matrix. Passing a PR build is necessary, not sufficient.
