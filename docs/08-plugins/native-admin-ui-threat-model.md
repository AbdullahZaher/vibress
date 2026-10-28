# NUI-00 — Native Admin UI Threat Model (Draft)

**Status:** Design review draft; neither an implemented control nor a penetration-test report.
**Baseline:** Vibress `main` after merged PR #88; independent LMS pilot `main`, both reviewed 2026-10-25.
**Depends on:** [Native UI RFC](native-admin-ui-rfc.md), [NUI-00 review](native-admin-ui-nui00-review.md), [Tier 2 isolation ADR](plugin-runtime-tier2-isolation-adr.md).

## Scope and authority boundaries

The proposed feature is an additional renderer for the **Staff Admin** only. It does not authorize executing unknown extensions, new public/member routes, arbitrary HTML, plugin-defined JavaScript, or direct browser database access.

### Protected assets

Staff session cookies and authentication state; global Staff permission and publication-local role; publication/workspace isolation; plugin registration and operator-approved artifact digests; publication settings/secrets; durable LMS course/lesson/member records; audit logs; browser origin/CSP integrity; availability of API, Redis, database and Admin renderer.

### Relevant actors

- **Operator:** approves and deploys immutable plugin releases; can enable native mode for an explicitly reviewed release. Operator trust is not an end-user grant.
- **Staff user:** authenticated to one or more publications; may view or mutate only with independent Host-verified global and local rights.
- **Extension author/code:** can contribute declared metadata and server handlers under operator trust; all metadata, persisted content, and return values are still treated as untrusted rendering data.
- **Attacker:** may have anonymous access, Member access, low-privilege Staff rights, a compromised account, or control of malicious/stale plugin-supplied strings. Do not assume the browser controls authoritative publication or permissions.

### Trust boundary inventory

| Boundary | Existing or proposed control |
| --- | --- |
| Operator package -> Host runtime | Approved immutable bytes, signature/admission checks and capability gates; Tier 1 is **not** process-sandboxed. Tier 2 remains blocked. |
| Approved module -> descriptor Registry | New: Zod validation, static versioned descriptors, component allowlist, registered ID references and scoped release identity. Invalid contributions rejected. |
| Registry/API -> Admin browser | New: data-only serializable JSON, escaped text, no raw HTML/JS, strict CSP, fixed Host components and Host-derived links. |
| Admin browser -> resource/action API | New: fixed Host transport and route registration; `requireStaffSession`, origin checks, fresh global + publication-local authorization and object ownership. |
| Authenticated Staff -> publication | Existing Staff publication resolution must remain authoritative on every API request; a client-supplied ID alone never grants access. |
| Admin -> legacy iframe | Existing opaque-origin sandbox, one-use Redis ticket, pinned HTML, CSP and MessagePort linked route; no weakening from Native. |
| API/Worker -> plugin storage | Existing Host-mediated, publication-scoped storage; new resource/action layer cannot expose raw SQL/DB clients. |

## Abuse cases, required controls, and negative tests

| Attack path | Impact | Control before native enablement | Verification |
| --- | --- | --- | --- |
| Text/resource data contains HTML, script, URL or bidi control characters | DOM XSS, phishing, misleading Admin states | Render text as inert nodes; reject unsafe link/icon/schema directives; data sanitization specific to context | Inject strings in titles, table rows, errors, field labels and validation messages; inspect DOM/navigation |
| Descriptor requests custom React module or component with executable callback | Arbitrary Staff-origin JS | Hardcoded component and property allowlists; no code, JSX, JS expressions, CSS classes or third-party imports | Reject custom component, dangerous URL, function, nested prohibited prop, unknown schema version |
| User tampers with resource/action ID, method or plugin ID | BFLA/confused deputy | Host registry resolves namespaced IDs from pinned approved release and checks live grants; browser cannot supply endpoints | Cross-plugin action alias, forged POST/read and binding-ID manipulation |
| A valid action targets another publication/member/course | IDOR, private content leak or corruption | Independent Staff global/local permission and resource ownership on every request; Host-selected publication context | Two publications with overlapping IDs; low-privilege Staff and member attempting Admin route |
| Request sent after user role revoked, logout, disable or plugin update | Stale rights or mismatched handler | Recheck current session, plugin admission/version, local membership and permissions on each action; cancel stale client state | Revoke/disable mid-session, replay previous page/action request, rotate release |
| Duplicate create/publish or CAS conflict | Data loss, double execution | Versioned preconditions, idempotency strategy per action, conflict response and audit | Repeated submissions, failed network acknowledgement, concurrent users, cross-replica retries |
| Malicious cursor, oversized filter or massive response | Scope escape, DoS, unbounded memory | Signed/opaque scope-bound cursors, limits on resource fields/rows/bytes/time, deterministic order | Alter cursor publication/actor/filter/sort, huge payload and slow handler |
| Data response from previous publication resolves late | Cross-publication browser leak | Scope query keys by publication and actor; generation token/AbortController; discard late data and clear drafts/secrets on switches | Toggle publications during slow GET/save; assert zero stale output |
| Native descriptor fails after rollout and Host silently loads iframe | Security downgrade, unexpected execution | Explicit state machine for no-native vs invalid/denied/revoked native; no fallback after denial | Malformed, unsupported, missing, disabled and unsigned variants |
| In-process Tier 1 plugin accesses host secrets/process | Privileged runtime compromise | Strict operator trust and existing admission policy; Tier 2 OS-level sandbox needed for untrusted packages | Security review of operator artifact; do not treat UI tests as sandbox proof |
| Old LMS iframe interpolates course data in HTML | Script execution in legacy frame | Fix dynamic interpolation separately and retain frame sandbox | Adversarial stored title/ID tests in LMS HTML and Host E2E before LMS GA |
| Disclosure through errors/logs/metrics | Session/secret or user data exposure | Sanitized errors and request IDs; no secret values in descriptors, response caches, logs or trace labels | Check logs, network traffic, rejected error payloads, masking after publication change |
| New feature flag/operator setting breaks self-host installs | Unsafe default or incompatible rollout | Default-off operator control with documented migration, validation and release digest binding | Fresh and populated upgrade, env missing/invalid, mixed-version Host and rollback |

## Server-side permission admission: mandatory sequence

1. Authenticate **Staff** on each resource/action request. Member or anonymous credentials cannot grant Admin rights.
2. Validate Origin/CSRF rules and all request parameters with shared runtime contracts.
3. Resolve authoritative active publication and membership from the Host, not the page descriptor or a raw caller-supplied tenant ID.
4. Resolve the immutable operator-approved plugin/release and its publication-enabled state and declared capability.
5. Resolve a namespaced, pre-registered resource/action ID; reject collisions and arbitrary URLs/methods.
6. Check both global Staff permission and publication-local role, then object/record ownership and any operation-specific policy.
7. Enforce input/output schemas, size/time/rate budgets, version constraints, idempotency and audit policy before/after handler execution as appropriate.
8. Emit sanitized errors and request IDs; invalidate browser-scoped state on denial.

Page-level permission is only a **visibility hint** for UI; no decision may be inherited from a rendered button. Existing `plugins.manage` is broad, but is not a generic third-party write grant. Any plugin-specific role map must be accepted by Host policy before enabling actions.

## Browser state and render invariants

- A descriptor never contains a script/function, URL from the extension, arbitrary style string, HTML, or executable markup.
- Immutable pinned descriptors may be cached by release identity only; current authorization is always checked separately and never cached globally.
- Resource state, form drafts and requests are keyed by actor, publication, plugin, approved release, view and resource/action identity where appropriate.
- Changes to Staff, publication, role, plugin state, release or locale trigger scoped invalidation; a stale async response is ignored, not rendered.
- Read-only Native pages may render before interactive actions ship; a UI must not imply a write ability without registered server capability.
- Existing iframe safeguards must remain intact. The frame is not intrinsically safe from all stored HTML injection; it provides containment, not data sanitization.

## Deployment and operations invariants

- Support self-hosted PostgreSQL/Redis/API/Worker deployments without a mandatory external UI service.
- No renderer-mode switch may write, truncate, or delete plugin records or change existing migrations.
- Signed/operator-approved artifacts must match across replicas; reject mixed-version action/descriptor mappings until explicit deployment compatibility is proven.
- Failure of Redis, database, authorization, plugin admission or schema validation must not create an alternative privileged data path.
- No new environment variable is approved by this document. If an operator-facing setting is introduced, version it, validate it, document its default, and test upgrade behavior.

## Security evidence required for sign-off

An approved action policy and route authorization test matrix; hostile text/descriptor fixtures; cross-publication and low-privilege Staff tests; role/session revocation tests; content-conflict/retry tests; browser E2E for XSS/keyboard/RTL/mobile; fresh and populated upgrades; immutable-release/version negotiation; Docker/multi-replica/rollback tests; separately tracked LMS legacy HTML sink remediation. **None of these checks was run as part of this documentation-only review.**

## Residual risk and ownership

**Security/API:** define exact action authorization, nested resource scope, cursor integrity, session refresh and failure semantics.
**Architect/Plugin reviewer:** freeze version negotiation, immutable descriptor admission, fallback states and migration constraints.
**Operations:** select rollout mechanism and verify mixed-version deployments.
**QA/i18n/Accessibility:** validate bounded schemas, keyboard/RTL/locale fallback and independent consumer compatibility.
**LMS owner:** remove unsafe dynamic HTML interpolation before promoting legacy LMS UI to production.

No residual risk has been accepted on behalf of an operator or security reviewer.
