# EXT-204 — Member identity and billing-plan check bridge

**Status:** draft, independent Host-mediated read-only bridge. **Not** a course/lesson
entitlement, enrollment API, payment authority, or a generalized Member CRUD SDK.

## Additive SDK

A `PluginApiRoute` with `audience: "member"` receives optional
`scope.memberAccess` **only** when the Host has independently verified:

1. A live Member session, matching the Host-resolved site's publication.
2. An active operator-vetted external plugin, enabled in that publication and
   declaring `extension.members.self.read` or `extension.entitlements.plan.read`.
3. The relevant **operation** capability remains declared and enabled when
   PostgreSQL performs the query. The member remains active and belongs to the
   bound publication. No result is served from an unscoped cache.

Methods:
- `getSelf()` returns `{id, displayName}` or null, without email, phone,
  sessions, payment details or metadata. Requires `extension.members.self.read`.
- `hasActivePlan(planId)` returns a boolean for the authenticated member's
  **billing plan** only. Requires `extension.entitlements.plan.read`.
  The repository compares the subscription member, plan and product publication
  inside one database transaction. Only `active` or `trialing` states grant
  a true result; past_due, unpaid, expired, cancelled, disabled members,
  archived/inactive plans or products, ended subscriptions and elapsed periods do
  not. A populated `trialEnd` is authoritative for a trial: a later billing
  period never overrides an expired trial. Recurring active subscriptions MUST
  have a future `currentPeriodEnd`. The existing free-checkout case is
  deliberately compatible: an `active`, zero-cost, no-provider subscription
  on a zero-cost `free` plan may have no end date; recurring paid plans cannot
  use this exception.
- No method accepts a Member ID, publication ID, arbitrary SQL or payment action.

The Host binds a trusted request ID alongside member, plugin and
publication identity. Every authorized `hasActivePlan` decision (true or
false) writes an `audit_events` entry **in the same PostgreSQL transaction**
as the lookup. The audit row stores the publication, request ID, plugin/plan
identifiers and boolean decision, plus a publication-scoped SHA-256 pseudonym
for the actor; it never stores raw member ID, email, display name or payment
provider data. Audit insertion failure rolls back the transaction and denies
the plan check. No Member identity is misrepresented as a Staff `actorUserId`.
The Host seals access at the end of the HTTP handler and waits for started
reads before responding; the API retains its `Cache-Control: no-store` and
Member-Origin validation on writes. There are no new HTTP paths or migrations.
Legacy plugin modules are unchanged; both SDK properties are optional.

## Security and design boundaries

**Plan subscription ≠ course entitlement.** An active subscription cannot be
used alone to unlock an LMS lesson. A future dedicated enrollment/entitlement
domain must verify the specific course, enrollment owner, status, lesson
publication and pricing policy under one authoritative scoped decision.
`scope.memberAccess` is neither available to Public/Admin routes nor an
identity selector, and never grants Member or Public generic storage writes.

Approved in-process ESM remains fully trusted code, not sandboxed Node JS.
Capability checks constrain mediated Host operations, not arbitrary process
access. Deployment still requires artifact provenance, Staging backup/restore,
privacy/security testing and publication-scale conformance.

## Acceptance

Test: unauthenticated, wrong publication, disabled member, disabled plugin,
capability revocation, foreign member/plan, paid recurring without an
end date, expired trial with a later period end, active free no-provider plan,
authorized true/false plan-decision audit, Host session closure, and no
content/identity leakage.
