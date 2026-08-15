# Vibress — Master Product & Engineering Execution Plan

> **Mission:** Evolve Vibress from a strong modern publishing platform into an **AI-native, collaborative, extensible, secure publishing operating system** that can credibly outperform WordPress, Ghost, and headless CMS competitors in the areas where Vibress chooses to compete.
>
> **Execution mode:** This document is not a proposal-only roadmap. The assigned Agent is expected to **execute the plan end-to-end, phase by phase**, using the existing Vibress architecture and repository conventions, until every applicable phase reaches its Definition of Done.

---

# 0. Agent Mandate

You are acting as a **Principal Software Architect, Senior Staff Full-Stack Engineer, Product Engineer, Security Engineer, QA Architect, and Release Engineer** for Vibress.

Your responsibility is to execute this roadmap across the existing monorepo while preserving production stability, backwards compatibility, data integrity, security boundaries, and the established Vibress architecture.

## 0.1 Mandatory repository rules

Before implementation:

1. Read and obey the repository root `AGENT.md`.
2. Treat the repository as the source of truth.
3. Do not repeatedly re-analyze the entire repository.
4. Work phase-by-phase using targeted inspection.
5. Reuse existing domain packages, utilities, patterns, test helpers, storage infrastructure, eventing, RBAC, audit, queue, and observability systems.
6. Do not introduce duplicate abstractions because a feature appears easier to build from scratch.
7. Do not rewrite existing migrations.
8. Do not perform opportunistic unrelated refactors.
9. Run focused validation during each phase.
10. Run the expensive full-repository validation once at major final gates, following `AGENT.md`.

## 0.2 Execution behavior

The Agent must:

- Execute all phases in dependency order.
- Continue automatically from one completed phase to the next.
- Do not stop merely to ask for approval after routine phase completion.
- Stop only for a real blocker requiring a product decision, unavailable secret/credential, destructive production operation, or ambiguity that cannot be safely resolved from the repository.
- Preserve all existing working Settings functionality.
- Never destroy production data.
- Never push remote branches/releases without explicit user authorization.
- Keep changes focused and architecture-consistent.

## 0.3 Progress ledger

Create and maintain:

```text
docs/roadmap/vibress-master-plan-progress.md
```

For every phase record:

```text
Status
Scope completed
Files changed
Architecture decisions
Migrations added
Focused tests executed
Known limitations
Deferred items
Next phase
```

Use one of:

```text
NOT STARTED
IN PROGRESS
BLOCKED
COMPLETE
```

Do not mark a phase `COMPLETE` until its acceptance criteria pass.

---

# 1. Product North Star

Vibress should not attempt to defeat WordPress by copying its plugin count or defeat Ghost by cloning every creator feature.

The target positioning is:

> **Vibress — The AI-native publishing operating system for modern content teams.**

The intended product characteristics are:

```text
Simple like Ghost
Structured like a headless CMS
Extensible like WordPress
Collaborative like modern productivity software
Secure by default
Self-hosted by design
Arabic-first without being Arabic-only
Automation-native
AI-native rather than AI-decorated
```

The strategic differentiators should become:

1. **Vibress Studio** — structured editor + real AI + real-time collaboration.
2. **Content Modeler** — custom structured content without sacrificing publishing UX.
3. **Secure Extension Platform** — extensibility without arbitrary unrestricted runtime code.
4. **Arabic-first Publishing** — first-class RTL, Arabic search, localization, typography, SEO, and AI.
5. **Integrated Growth & Automation** — audience, memberships, newsletters, commerce, automations, analytics.
6. **Modern Distribution** — web, email, RSS, AI-readable formats, ActivityPub, APIs.
7. **Enterprise-grade Operations** — reliable upgrades, migrations, backups, identity, audit, observability.

---

# 2. Current Architecture Baseline

The current repository already has a strong foundation and should be evolved rather than replaced.

Observed top-level applications:

```text
apps/admin
apps/api
apps/web
apps/portal
apps/worker
```

Core technology direction:

```text
TypeScript strict
React
Vite Admin
Next.js public web
Fastify API
PostgreSQL + Drizzle
Redis
BullMQ
Nx
pnpm workspaces
Playwright
Vitest
Docker Compose
```

The codebase already contains numerous bounded domain packages for publishing, members, billing, search, themes, plugins, automations, analytics, security, revisions, events, queues, storage, and related capabilities.

The plan must preserve the current **modular monolith** direction unless a specific phase proves that an existing boundary prevents the required capability.

---

# 3. Global Engineering Principles

Every phase must follow these rules.

## 3.1 No fake production functionality

No production UI may claim functionality using:

```text
fake setTimeout persistence
fake success alerts
hardcoded server-like data
console-only operations
placeholder success messages
```

A disabled or explicitly experimental feature is preferable to fake behavior.

## 3.2 End-to-end completion standard

A feature is not complete unless the applicable chain is proven:

```text
UI
→ Handler
→ Hook/state
→ API client
→ HTTP route
→ Authentication
→ Authorization
→ Validation
→ Domain service
→ Repository / external service
→ Persistence
→ Events/jobs where applicable
→ Runtime consumer
→ UI feedback
→ Automated verification
```

## 3.3 Security by default

Security-sensitive functionality requires:

```text
backend RBAC
input validation
secret redaction
audit trail
CSRF/origin protection where applicable
rate limiting where applicable
safe file handling
tenant/workspace isolation where applicable
```

Frontend hiding is never authorization.

## 3.4 Backwards compatibility

Preserve:

```text
existing REST contracts unless intentionally versioned
existing URLs
existing stored content
existing revisions
existing themes
existing settings
existing public URLs
existing member sessions where security permits
```

Breaking changes require explicit migration/versioning strategy.

## 3.5 Test escalation

Follow repository `AGENT.md`:

```text
affected unit tests
→ affected package tests
→ integration tests
→ focused E2E
→ final full-repository gate
```

---

# 4. Master Phase Map

| Phase | Name | Priority | Strategic Result |
|---|---|---:|---|
| 0 | Baseline & Safety Gate | P0 | Reliable starting point |
| 1 | Trust & Production Hardening | P0 | Remove credibility/operations risks |
| 2 | Admin Platform Foundation | P0/P1 | Maintainable admin architecture |
| 3 | Vibress AI Gateway | P1 | Real AI platform |
| 4 | Studio Collaboration & Editorial Workflow | P1 | Major product moat |
| 5 | Content Modeler | P1 | Expand from publishing CMS to content platform |
| 6 | Secure Extensions & Theme Ecosystem | P1 | Safe extensibility |
| 7 | Arabic-First Internationalization | P1/P2 | MENA differentiation |
| 8 | Search 2.0 | P2 | Excellent multilingual discovery |
| 9 | Media Platform 2.0 | P2 | Modern asset pipeline |
| 10 | Visual Automations | P2 | Growth/workflow differentiation |
| 11 | Distribution, GEO & Social Web | P2 | Publish once, distribute everywhere |
| 12 | Multi-Publication Workspaces | P3 | Enterprise/agency capability |
| 13 | Enterprise Identity & Governance | P3 | Enterprise readiness |
| 14 | Production Operations & Release Engineering | P1/P2 | Reliable deployment/upgrades |
| 15 | Observability, Performance & Reliability | P1/P2 | Production excellence |
| 16 | Developer Platform & Ecosystem | P2/P3 | External adoption |
| 17 | Final Competitive Verification | Final | Evidence-based production sign-off |

---

# PHASE 0 — Baseline & Safety Gate

## Goal

Establish a reproducible baseline before broad product evolution.

## Tasks

### 0.1 Inspect project commands

Verify root and affected workspace scripts before running them.

Record:

```text
Node version
pnpm version
Nx version
database migration state
current branch/SHA
working tree status
```

### 0.2 Run baseline verification

Use actual repository scripts.

Capture:

```text
typecheck
affected unit tests
affected integration tests
current critical E2E
admin build
api build
web build
worker build
portal build
```

Do not run every expensive suite repeatedly afterward.

### 0.3 Establish benchmark snapshots

Capture baseline for:

```text
Admin main bundle
Public web route bundle
API p50/p95 on representative read/write endpoints
Search latency
Post editor initial load
Public article rendering
Docker image sizes
Startup time
```

### 0.4 Preserve current production-ready Settings

Treat the current unified Settings system as a protected regression surface.

Add/retain smoke tests for:

```text
settings persistence
RBAC
site privacy
navigation
branding
comments policy
code injection permissions
import/export
system maintenance
```

## Acceptance Criteria

- Baseline stored in the progress ledger.
- Existing unrelated failures clearly identified.
- No source behavior changed during baseline.
- Critical Settings regressions covered.

---

# PHASE 1 — Trust & Production Hardening

This phase must be completed before major feature expansion.

---

## 1A. Remove Fake AI and Establish Honest Feature State

### Current concern

`packages/studio-react/src/plugins/InlineAIPlugin.tsx` currently contains simulated AI behavior and UI language referring to external AI behavior.

### Tasks

1. Remove all production fake AI generation.
2. Do not expose branding such as `"Notion AI"`.
3. Until the real AI Gateway in Phase 3 is ready:
   - hide the feature behind an explicit capability flag, or
   - render a clearly disabled/experimental state.
4. No fake generated output may remain reachable in production.

### Acceptance Criteria

- Search confirms no fake AI completion implementation remains.
- Studio remains stable without AI enabled.
- Tests cover feature-disabled behavior.

---

## 1B. Fix Canonical URL Architecture

### Current concern

`apps/admin/src/components/PostEditor.tsx` derives canonical URLs from `window.location.origin` and generated slug, which can produce Admin-origin canonical URLs and route mismatches.

### Required architecture

Canonical override should be optional.

Default canonical must be generated by the public rendering/SEO layer from:

```text
configured public site URL
+
actual public content route
```

### Tasks

1. Stop automatically storing Admin-origin canonical URLs.
2. Keep canonical field empty unless user intentionally overrides.
3. Display UI text such as:

```text
Leave blank to use the default canonical URL.
```

4. Generate default canonical centrally.
5. Verify:
   - post canonical
   - page canonical
   - custom override
   - domain changes
   - redirects
   - preview mode does not leak preview URLs

### Acceptance Criteria

- No canonical URL uses Admin origin by default.
- Public canonical matches real public route.
- Existing explicit canonical overrides still work.
- SEO E2E added.

---

## 1C. Production Docker Runtime Artifacts

### Current concern

API/Worker production runtime currently builds TypeScript but starts source using `tsx`, and production images may contain more workspace/source material than necessary.

### Target

```text
builder
→ compile/bundle
→ production dependency prune
→ minimal immutable runtime
→ node compiled-entry.js
```

### Tasks

1. Refactor API production image.
2. Refactor Worker production image.
3. Remove runtime TypeScript compiler requirement.
4. Do not copy unnecessary repository files.
5. Run as non-root where compatible.
6. Add:
   - OCI labels
   - app version
   - Git SHA
   - build timestamp
7. Produce SBOM if current CI tooling supports it cleanly.
8. Preserve local development behavior.

### Acceptance Criteria

- Production API/Worker run compiled JS.
- Runtime images contain only required artifacts/dependencies.
- Container health checks pass.
- Existing production compose flows remain functional.
- Image sizes are recorded and compared with baseline.

---

## 1D. Migration Startup Safety

### Goal

Prevent a new application version from starting against an incompatible old schema.

### Tasks

Implement a safe migration startup model such as:

```text
DB healthy
→ migration job succeeds
→ API/Worker become eligible to start
```

or a documented expand/contract strategy for zero-downtime upgrades.

Requirements:

- migration failures block incompatible application startup;
- migrations remain idempotently managed by the existing migration system;
- do not rewrite existing migrations;
- backup/restore process remains valid.

### Acceptance Criteria

- Fresh deployment applies migrations successfully.
- Failed migration prevents unsafe application startup.
- Upgrade from previous test snapshot works.
- Rollback/recovery procedure documented.

---

## 1E. Release Versioning

Replace indefinite `0.0.0` product posture with a real release strategy.

### Tasks

Define:

```text
SemVer policy
release candidate policy
changelog strategy
Git tag convention
Docker tag convention
compatibility metadata
plugin/theme compatibility fields
```

Do not mass-change package versions blindly. Choose a monorepo versioning strategy first.

### Acceptance Criteria

- Release process documented.
- Build artifacts expose version and SHA.
- `/health` or diagnostics exposes safe build/version metadata.

---

# PHASE 2 — Admin Platform Foundation

## Goal

Replace manual route orchestration with a maintainable application platform before Admin complexity increases.

### Current concern

Admin navigation currently relies heavily on:

```text
window.location.pathname
history.pushState
manual currentPath condition trees
```

while TanStack Query is already used and routing infrastructure can be made declarative.

## 2.1 Real Admin Router

Use the existing installed routing solution if suitable. Do not introduce another router unnecessarily.

Target route model:

```text
/admin
/admin/posts
/admin/posts/new
/admin/posts/$postId
/admin/pages
/admin/pages/$pageId
/admin/media
/admin/members
/admin/analytics
/admin/settings
...
```

Support:

```text
nested layouts
route guards
permission metadata
404
search params
deep links
browser navigation
lazy route chunks
```

## 2.2 Route-level authorization

Create one consistent mechanism for:

```text
authentication
setup state
role/permission guards
redirect behavior
```

Backend remains authoritative.

## 2.3 Query architecture

Standardize TanStack Query usage:

```text
query key factory
consistent stale times
mutation invalidation
error mapping
loading boundaries
retry policy
```

Avoid unnecessary global state.

## 2.4 Admin error boundaries

Implement:

```text
route error boundary
card/feature-level error states
retry
not-found state
permission denied state
```

## 2.5 Bundle splitting

Ensure major routes are lazy-loaded where beneficial.

Track bundle change relative to baseline.

## Acceptance Criteria

- Manual path-condition routing is removed or reduced to compatibility adapters.
- Deep links and browser back/forward work.
- Existing legacy Settings routes remain valid.
- Authentication/setup flow has regression E2E.
- No material bundle regression without justification.

---

# PHASE 3 — Vibress AI Gateway

## Goal

Make AI a real platform capability rather than a UI gimmick.

## 3.1 Architecture

Create a server-side AI abstraction.

Suggested conceptual boundary:

```text
@vibress/ai
```

Only create a new package if it fits existing bounded-context conventions.

Core interfaces should support:

```text
provider
model
streaming
structured output
tool execution
usage metadata
request cancellation
timeouts
rate limits
cost metadata
```

Possible providers:

```text
OpenAI
Anthropic
Gemini
OpenAI-compatible/local provider
custom provider adapter
```

Do not require every provider in the first implementation. Design capability-based adapters.

## 3.2 Secret security

Provider API keys:

- server-side only;
- encrypted/masked using existing secret infrastructure;
- never exposed to browser;
- never placed into audit payloads;
- separate permissions for AI configuration.

## 3.3 Studio AI UX

Replace fake Inline AI with real operations:

```text
Continue writing
Rewrite
Shorten
Expand
Change tone
Translate
Summarize
Generate outline
Generate excerpt
Headline alternatives
Meta title
Meta description
Alt text
Internal link suggestions
Newsletter variant
Social variants
```

Requirements:

```text
streaming output
cancel
retry
accept/reject
diff preview
undo
never silently overwrite content
```

## 3.4 Context system

AI may use authorized context:

```text
current structured document
selected block/text
publication style settings
approved previous content
tags
metadata
internal links
brand voice
```

Never include private/member-only content unless explicitly authorized by product rules.

## 3.5 Usage controls

Implement:

```text
per-user limits
per-workspace/publication usage
provider/model configuration
usage reporting
cost estimation where possible
timeout/circuit breaker behavior
```

## 3.6 AI safety and provenance

Store useful metadata:

```text
AI operation type
actor
model/provider
timestamp
accepted/rejected state
```

Do not store hidden provider reasoning.

## Tests

- provider adapter tests
- streaming cancellation
- secret masking
- permission tests
- request validation
- Studio accept/reject E2E
- provider failure UX
- rate-limit behavior

## Acceptance Criteria

- No fake AI remains.
- At least one real provider path works end-to-end when configured.
- A deterministic test provider exists for automated tests.
- Studio AI operations are streaming and reversible.

---

# PHASE 4 — Studio Collaboration & Editorial Workflow

## Goal

Turn Vibress Studio into a collaborative editorial workspace that surpasses traditional single-author CMS editing.

---

## 4.1 Collaboration architecture

Evaluate a proven CRDT/collaboration technology before inventing one.

Requirements:

```text
real-time multi-user editing
presence
collaborative cursors/selections
offline/reconnect handling
document version compatibility
server persistence
authorization
```

Potential architecture:

```text
Studio structured document
+
CRDT collaboration layer
+
persistent revisions
+
event/audit layer
```

Do not discard the existing structured document and revision system.

## 4.2 Presence

Show:

```text
who is viewing
who is editing
cursor/selection
last active
```

Presence is ephemeral and should not pollute durable content history.

## 4.3 Suggestions and comments

Implement:

```text
inline comments
threaded comments
mentions
resolve/reopen
suggested changes
accept/reject
```

## 4.4 Editorial states

Evolve beyond:

```text
draft
scheduled
published
```

Target workflow model:

```text
Draft
In Review
Changes Requested
Approved
Scheduled
Published
Archived
```

Do not hardcode future workflows into one enum if a more extensible state machine fits existing architecture.

## 4.5 Assignments

Support:

```text
assignee
reviewers
due date
editorial notes
review status
```

## 4.6 Revision comparison

Add visual diff:

```text
revision A ↔ revision B
actor
timestamp
changed blocks
restore
```

## 4.7 Publish authorization

Allow policy such as:

```text
author can draft
editor can approve
publisher/admin can publish
```

Use existing RBAC infrastructure.

## 4.8 Conflict migration

Existing optimistic-concurrency behavior must remain safe for clients not using collaboration.

## Tests

- two-browser collaboration E2E
- simultaneous edits
- reconnect
- comment thread
- suggestion accept/reject
- workflow permission transitions
- revision restore
- security/isolation

## Acceptance Criteria

- Two users can edit the same document without refresh-based conflict resolution.
- Editorial review is first-class.
- Existing content remains compatible.

---

# PHASE 5 — Content Modeler

## Goal

Expand Vibress from a fixed publishing CMS into a structured content platform without losing its specialized editorial UX.

---

## 5.1 Product concept

Admin section:

```text
Content Models
```

Users can define types such as:

```text
Article
Podcast
Course
Event
Movie
Product Review
Job
Restaurant
Research Paper
```

## 5.2 Field types

Initial supported field system:

```text
short text
long text
rich/Studio document
number
boolean
date
datetime
URL
email
select
multi-select
media
taxonomy/tag
relation
relation list
JSON/structured object where justified
```

## 5.3 Field configuration

Support:

```text
required
default
help text
validation
min/max
regex where safe
unique
localizable
searchable
filterable
API visibility
```

## 5.4 Storage design

Do not immediately create arbitrary physical SQL tables per user-defined type unless a rigorous migration strategy supports it.

Evaluate:

```text
typed metadata model
JSONB + indexed extracted fields
hybrid model
```

Choose based on query requirements, portability, migrations, and performance.

## 5.5 Generated Admin UI

Content model definitions should generate:

```text
list view
create editor
edit editor
filters
validation
relations
revision history
permissions
```

## 5.6 API generation

Expose model-aware contracts through existing API versioning patterns.

Provide:

```text
list
get by id/slug
create
update
delete/archive
filter
sort
pagination
relations
```

Generate or extend OpenAPI contracts.

## 5.7 Search integration

Model fields marked searchable should feed the search indexing pipeline.

## 5.8 Webhooks/events

Emit typed events:

```text
content.<model>.created
content.<model>.updated
content.<model>.published
```

or an architecture-consistent equivalent.

## 5.9 Revisions

All editable structured entries should participate in the revision architecture.

## Tests

- model creation
- field validation
- relation integrity
- API contract
- permission checks
- schema evolution
- deleting/renaming fields
- migration compatibility
- search integration

## Acceptance Criteria

- User can create a custom content model without code.
- Generated Admin editor is usable.
- Entries persist and have API access, permissions, revisions, filters, and search.

---

# PHASE 6 — Secure Extensions & Theme Ecosystem

## Goal

Offer strong extensibility without copying WordPress's unrestricted runtime model.

---

## 6.1 Extension manifest

Define a versioned manifest containing:

```text
id
name
publisher
version
requiredVibressVersion
permissions
admin extensions
events/subscriptions
settings schema
network access declarations
capabilities
```

## 6.2 Permission model

Examples:

```text
content.read
content.write
members.read
admin.navigation.extend
webhook.register
network.request:<declared-host>
```

Extensions must not receive raw DB access or secrets by default.

## 6.3 Installation lifecycle

Target:

```text
upload/install
→ verify package
→ verify signature/checksum
→ validate compatibility
→ display requested permissions
→ install disabled
→ administrator approves
→ enable
```

## 6.4 Runtime isolation

Do not execute arbitrary untrusted extension packages inside the main Fastify process.

Evaluate safer mechanisms:

```text
worker/process isolation
WebAssembly where suitable
restricted RPC
remote extension host
sandboxed Admin iframe for untrusted UI
```

Trusted first-party build-time plugins may retain existing path.

## 6.5 Extension events/API

Expose stable capabilities rather than internal imports.

Use:

```text
versioned SDK
events
commands
typed APIs
capability checks
```

## 6.6 Theme lifecycle

Evolve themes into:

```text
install
preview
activate
update
rollback
compatibility check
version history
```

Custom theme code editing must be permission-gated and versioned.

## 6.7 Registry

Prepare architecture for a future registry/marketplace:

```text
publisher identity
package signature
version metadata
compatibility
security status
review status
```

Do not build a commercial marketplace before package security/update foundations exist.

## Tests

- malicious manifest
- unauthorized permission
- incompatible version
- package tampering
- path traversal
- extension disable/rollback
- theme rollback
- security boundary

## Acceptance Criteria

- A third-party extension can add value through a stable SDK without unrestricted DB/process access.
- Install permissions are explicit.
- Extensions/themes are versionable and reversible.

---

# PHASE 7 — Arabic-First Internationalization

## Goal

Make Vibress the strongest first-class Arabic/RTL publishing platform while preserving excellent English/multilingual use.

---

## 7.1 Admin localization

Eliminate hardcoded product strings from Admin where practical.

Use existing i18n architecture or extend it consistently.

Support:

```text
English
Arabic
runtime locale selection
RTL/LTR switching
```

## 7.2 Portal localization

Apply same first-class behavior to Member Portal.

## 7.3 Public localization

Support site-level and content-level localization separately.

## 7.4 Localized content fields

For models/content where enabled, support:

```text
title.en
title.ar
excerpt.en
excerpt.ar
content variants
localized slug
localized metadata
```

Avoid forcing every site into multilingual mode.

## 7.5 Translation workflow

Support:

```text
source locale
translation status
assigned translator
out-of-date translation indicator
```

## 7.6 Arabic editor quality

Verify:

```text
RTL cursor behavior
mixed Arabic/English
lists
quotes
code blocks
inline formatting
selection
AI prompts
```

## 7.7 Arabic typography

Provide strong defaults:

```text
Arabic font stacks
line height
punctuation spacing
number handling
mixed-script rendering
```

## 7.8 Dates

Support:

```text
locale-aware Gregorian
optional Hijri presentation
timezone-aware rendering
```

## Acceptance Criteria

- Admin can be fully operated in Arabic RTL.
- Public themes correctly support RTL.
- Arabic/English mixed content edits without layout corruption.
- Translation workflow works for supported content types.

---

# PHASE 8 — Search 2.0

## Goal

Build multilingual, typo-tolerant, semantically useful discovery while preserving PostgreSQL-first simplicity.

---

## 8.1 Lexical foundation

Improve existing PostgreSQL search with:

```text
full-text search
trigram typo tolerance
prefix weighting
title weighting
tag weighting
recency signals
business ranking
```

## 8.2 Arabic normalization

Implement and test:

```text
diacritic removal
tatweel removal
أ/إ/آ normalization
ى normalization where appropriate
Arabic punctuation handling
mixed Arabic/English tokenization
```

Use linguistically defensible behavior; avoid destructive normalization for stored source content.

## 8.3 Semantic layer

Evaluate PostgreSQL vector support or current infrastructure before adding another search service.

Semantic search should be optional and additive:

```text
lexical score
+
semantic score
+
business score
```

## 8.4 Index pipeline

Use existing Worker/queue architecture for:

```text
index update
reindex
embedding generation
failure retry
versioned indexing
```

## 8.5 Search observability

Record:

```text
query latency
zero-result rate
popular searches
click-through
failed indexing
```

without storing sensitive search data unnecessarily.

## Tests

- Arabic variants
- typo search
- English
- mixed script
- ranking
- permission/public visibility
- reindex
- stale document removal

## Acceptance Criteria

- Arabic search is first-class.
- Search tolerates common typos.
- Semantic search does not override obvious lexical matches incorrectly.
- p95 does not regress beyond agreed baseline budget.

---

# PHASE 9 — Media Platform 2.0

## Goal

Turn Media into a modern production asset pipeline.

---

## 9.1 Image derivatives

On upload, asynchronously generate:

```text
responsive widths
WebP
AVIF where supported
thumbnail
blur/placeholder
dimensions
dominant color where useful
```

Preserve original.

## 9.2 Image editing

Provide:

```text
crop
rotate
focal point
aspect presets
alt text
caption
```

Store transformations non-destructively.

## 9.3 Delivery

Generate `srcset`/sizes from canonical media metadata.

## 9.4 Video

Design optional pipeline:

```text
probe
poster
transcode
HLS
duration
captions
```

Do not block initial media improvements on full video transcoding if operational footprint is too high.

## 9.5 Audio

Support:

```text
duration
metadata
waveform
podcast-friendly embed
```

## 9.6 Security

Maintain or strengthen:

```text
magic-byte validation
MIME checks
size limits
malware scanning hook where deployable
SVG sanitization/policy
path isolation
reference-aware deletion
```

## Tests

- invalid file
- spoofed MIME
- oversized upload
- derivative job
- missing storage
- reference protection
- responsive public render

## Acceptance Criteria

- Public images use optimized derivatives.
- Original is preserved.
- Media Library supports non-destructive editing.

---

# PHASE 10 — Visual Automations

## Goal

Expose the existing automation capabilities through a professional workflow builder.

---

## 10.1 Visual model

UI concept:

```text
WHEN
event

IF
conditions

THEN
actions

WAIT
duration

THEN
next action
```

## 10.2 Supported triggers

Use actual event catalog from repository.

Examples may include:

```text
member.created
subscription.started
post.published
comment.created
form/submission events
```

Do not invent unsupported event names without implementing them.

## 10.3 Conditions

Support typed operators appropriate to data type.

## 10.4 Actions

Integrate existing capabilities:

```text
send email
add/remove tag
webhook
notification
member update
wait
branch
```

## 10.5 Versioning

Published automation versions must be immutable enough for run traceability.

## 10.6 Run inspector

Expose:

```text
run status
step status
input
safe output
duration
error
retry
```

Mask secrets.

## 10.7 Safety

Prevent:

```text
infinite loops
runaway fan-out
unbounded retries
recursive event storms
```

## Acceptance Criteria

- Non-technical admin can build a useful workflow visually.
- Runs are observable and retryable.
- Existing automation domain remains the execution authority.

---

# PHASE 11 — Distribution, GEO & Social Web

## Goal

Make Vibress a distribution engine rather than a website-only CMS.

---

## 11.1 Machine-readable content

Provide opt-in/public-safe endpoints such as:

```text
/llms.txt
/llms-full.txt
/posts/<slug>.md
/pages/<slug>.md
```

Only expose content already allowed to the public.

Never bypass:

```text
paywall
members-only
private site
robots/crawler policy
```

## 11.2 Structured provenance

Improve:

```text
author schema
publisher schema
publication date
modified date
canonical source
citations/references where available
```

## 11.3 AI crawler policy

Admin control for crawler groups where legally/technically appropriate.

## 11.4 ActivityPub

Implement a standards-compliant ActivityPub layer incrementally:

```text
Actor
WebFinger
Outbox
Create/Update/Delete activities
Follow/Accept
signature verification
inbox processing
```

Security requirements:

```text
SSRF protection
signature verification
request size limits
rate limits
deduplication
queue processing
blocked-domain controls
```

Start with outbound publishing if full federation is too large for one safe increment, but continue through the roadmap until planned scope is complete.

## 11.5 Distribution composer

From one source article generate/manage:

```text
web version
newsletter version
RSS
ActivityPub
social copy
```

Use AI only as assistive generation with explicit user review.

## Acceptance Criteria

- Public content has safe machine-readable representation.
- ActivityPub interoperability passes tests against known fixtures/servers where feasible.
- Private/member content cannot leak through distribution surfaces.

---

# PHASE 12 — Multi-Publication Workspaces

## Goal

Support agencies, media groups, institutions, and enterprises.

---

## 12.1 Domain model

Introduce:

```text
Workspace
Publication
WorkspaceMembership
PublicationMembership / role scope
```

Do not retrofit tenancy casually.

Perform a full data-scope design before migration.

## 12.2 Scoping

Every tenant-sensitive domain must establish explicit scope.

Potentially:

```text
posts
pages
settings
themes
members
newsletters
analytics
billing
media
automations
integrations
```

Decide intentionally which resources are:

```text
workspace-shared
publication-scoped
global platform resources
```

## 12.3 Context propagation

Create one authoritative context mechanism across:

```text
API
domain service
repository
jobs
events
webhooks
audit
cache
```

## 12.4 Admin UX

Support:

```text
workspace switcher
publication switcher
cross-publication dashboard
role-aware navigation
```

## 12.5 Cross-publishing

Allow authorized content reuse with clear ownership and canonical behavior.

## 12.6 Migration

Existing single-publication installations must migrate into a default workspace/publication without content loss.

## Security tests

Tenant isolation is mandatory:

```text
IDOR
cache key isolation
job isolation
webhook isolation
search isolation
analytics isolation
media isolation
```

## Acceptance Criteria

- Existing installations migrate safely.
- Cross-tenant data leakage tests pass.
- Multiple publications operate independently within one workspace.

---

# PHASE 13 — Enterprise Identity & Governance

## Goal

Enable enterprise sales without compromising self-hosted simplicity.

---

## 13.1 MFA

Implement:

```text
TOTP
recovery codes
session invalidation
MFA enrollment audit
```

## 13.2 Passkeys/WebAuthn

Add:

```text
registration
authentication
credential management
recovery path
```

## 13.3 OIDC

Support standards-based enterprise SSO.

## 13.4 SAML

Add only if product/enterprise scope justifies it after OIDC foundation.

## 13.5 SCIM

Provision/deprovision enterprise staff accounts and group mappings.

## 13.6 Session/device management

Admin/user UI:

```text
active sessions
device metadata
revoke session
revoke all
```

## 13.7 Governance

Add options such as:

```text
IP allowlists
session policies
MFA enforcement
audit export
retention controls
```

## Acceptance Criteria

- MFA is production-safe.
- SSO does not bypass local RBAC.
- Deprovisioning revokes effective access.
- Audit events cover identity changes.

---

# PHASE 14 — Production Operations & Release Engineering

## Goal

Make upgrades and recovery boring, predictable, and safe.

---

## 14.1 Upgrade command/workflow

Provide a documented sequence:

```text
preflight
backup
pull/install artifact
migrate
start
health verify
post-upgrade smoke
```

## 14.2 Backup system

Support verified backups for:

```text
PostgreSQL
object storage metadata/files
critical secrets/config references
```

Do not export raw external-provider secrets into unsafe bundles.

## 14.3 Restore drill

Automate a periodic/test restore validation.

## 14.4 Rollback

Document what can be rolled back:

```text
application image
config
DB migration compatibility
theme version
extension version
```

Use expand/contract for changes that cannot be safely downgraded.

## 14.5 Health endpoints

Separate:

```text
liveness
readiness
deep diagnostics
```

Do not expose sensitive diagnostic data publicly.

## 14.6 Supply-chain hardening

Where current tooling allows:

```text
lockfile frozen installs
Trivy
SBOM
signed images/releases
provenance
dependency review
```

## Acceptance Criteria

- Fresh install documented and tested.
- Upgrade from previous release tested.
- Restore drill succeeds.
- Failed migration does not result in partially started incompatible services.

---

# PHASE 15 — Observability, Performance & Reliability

## Goal

Make production behavior measurable before scaling usage.

---

## 15.1 Request tracing

Use/extend existing observability infrastructure:

```text
request ID
trace context
API
worker jobs
webhooks
external calls
```

## 15.2 Metrics

Track:

```text
request latency
error rates
DB pool
Redis health
queue depth
job latency
email delivery
webhook delivery
search indexing
AI provider latency/errors
media processing
```

## 15.3 Structured logs

Requirements:

```text
JSON in production
request ID
actor/resource where safe
no secrets
no password/token leakage
```

## 15.4 Error reporting

Integrate an optional provider-neutral error reporting adapter.

## 15.5 Performance budgets

Use Phase 0 baseline.

Rules:

- No critical public route should regress materially without documented justification.
- Track Admin route bundle sizes.
- Track p95 API latency.
- Track worker backlog under representative load.
- Add targeted caching only where correctness remains explicit.

## 15.6 Load verification

Maintain or extend Autocannon/load scripts for:

```text
content reads
admin reads
search
member auth
webhook intake
```

Never load-test production without authorization.

## Acceptance Criteria

- Operational failures are diagnosable from logs/metrics.
- Core workloads have recorded performance baselines.
- No secret leakage in observability output.

---

# PHASE 16 — Developer Platform & Ecosystem

## Goal

Make Vibress attractive to external developers, theme authors, agencies, and integrators.

---

## 16.1 Stable public API documentation

Generate/maintain:

```text
OpenAPI
examples
authentication
pagination
errors
rate limits
webhooks
```

## 16.2 Plugin SDK documentation

Document:

```text
manifest
permissions
lifecycle
events
Admin extension API
testing
version compatibility
```

## 16.3 Theme SDK

Provide:

```text
starter theme
design tokens
content APIs
navigation APIs
membership helpers
preview
testing
compatibility
```

## 16.4 CLI

Create/extend a Vibress CLI only where it provides clear value:

```text
create theme
validate theme
pack extension
validate extension
dev environment
health/preflight
backup/restore helpers
```

Do not create a large CLI simply for branding.

## 16.5 Examples

Maintain high-quality sample integrations.

## 16.6 Documentation quality

Docs should distinguish:

```text
user docs
administrator docs
developer docs
self-hosting docs
architecture docs
security docs
```

## Acceptance Criteria

- A new developer can build a basic theme/extension without reading internal source.
- API docs match actual contracts.
- Compatibility/version rules are explicit.

---

# PHASE 17 — Final Competitive Verification & Production Sign-Off

## Goal

Prove the result rather than declare it.

---

## 17.1 Full validation gate

Following repository conventions, run the final expensive gate once:

```text
frozen dependency installation if required
lint
typecheck
full unit/integration tests
full required E2E
production builds
migration verification
security scan
```

Use actual repository scripts.

## 17.2 Critical E2E journeys

At minimum cover:

### Publishing

```text
create
edit
collaborate
review
approve
schedule
publish
public render
revision restore
```

### AI

```text
configured provider
stream output
cancel
accept/reject
provider failure
permission
usage accounting
```

### Custom content

```text
create model
create entry
relation
publish
API query
search
revision
```

### Extension

```text
install
permissions
enable
use
disable
rollback
```

### Arabic

```text
Arabic Admin
RTL editor
Arabic slug/search
Arabic public render
localized content
```

### Search

```text
Arabic typo
English
mixed language
semantic
reindex
```

### Media

```text
upload
derivatives
crop/focal
public responsive render
```

### Automation

```text
trigger
condition
wait
action
failure
retry
run history
```

### Workspace

```text
two publications
permissions
cross-tenant negative tests
```

### Enterprise auth

```text
MFA
session revoke
SSO role mapping
```

### Operations

```text
fresh deploy
migration
upgrade
backup
restore
health
```

---

# 17.3 Security sign-off

No release may be called complete with unresolved:

```text
Critical vulnerability
High vulnerability affecting supported deployment
tenant isolation bypass
auth bypass
secret leakage
unsafe extension execution
path traversal
stored XSS without privilege boundary
SQL injection
destructive-operation authorization flaw
```

---

# 17.4 Competitive scorecard

At final completion, score Vibress with evidence against these dimensions:

| Dimension | Target |
|---|---|
| Editor simplicity | Ghost-class |
| Collaboration | Better than traditional CMS workflows |
| Content modeling | Competitive with modern headless CMS |
| Extensibility | Safer than unrestricted plugin execution |
| Arabic/RTL | Best-in-class |
| Search | Strong multilingual + semantic |
| Membership/Growth | Integrated first-class |
| Automation | Native visual workflows |
| Security | Secure-by-default |
| Self-hosting | Reproducible and supportable |
| Enterprise | Workspace + SSO/MFA/governance |
| Developer experience | Typed, documented, versioned |
| AI | Contextual, reversible, provider-agnostic |

Do not claim superiority based on feature count alone.

---

# 18. Global Definition of Done

The complete roadmap is done only when all applicable conditions below hold.

## Product

- No fake feature is presented as real.
- Vibress Studio supports real AI.
- Real-time collaboration and editorial workflow operate.
- Custom content models can be created without code.
- Extension/theme lifecycle is safe and versioned.
- Arabic Admin and RTL publishing are first-class.
- Search is strong for Arabic and English.
- Media has optimized delivery.
- Automations have a visual workflow builder.
- Public distribution includes modern machine-readable/social capabilities.
- Multi-publication workspaces function with strict isolation.
- Enterprise identity features are enforceable.

## Engineering

- Existing modular architecture remains coherent.
- No unnecessary microservices are introduced.
- Public APIs are versioned/documented.
- Production API/Worker run compiled artifacts.
- Migration startup is safe.
- Releases are versioned.
- No unresolved high-risk fake/stub code remains.

## Security

- RBAC is backend-enforced.
- Secrets remain masked/encrypted appropriately.
- Extension execution is permissioned and isolated.
- Tenant isolation is tested.
- File/archive processing is hardened.
- AI provider secrets never reach the browser.
- Code injection remains privileged.

## Quality

- Focused tests exist for each phase.
- Final test suite passes.
- Production builds pass.
- Critical E2E journeys pass.
- Migration/upgrade/restore tests pass.
- Performance does not materially regress without documented reason.

## Operations

- Fresh install works.
- Upgrade works.
- Backup/restore works.
- Health/readiness works.
- Logs/metrics provide actionable diagnostics.
- Release artifacts expose version/SHA.

---

# 19. Required Final Agent Deliverable

When all phases are complete, produce:

```text
docs/roadmap/vibress-master-plan-final-report.md
```

The report must include:

## Executive verdict

```text
PRODUCTION READY
PRODUCTION READY WITH CONDITIONS
NOT PRODUCTION READY
```

## Phase status

| Phase | Status | Major Deliverables | Tests |
|---|---|---|---|

## Architecture changes

Explain only meaningful architectural decisions.

## Database migrations

List every new migration and its purpose.

## Security review

List:

```text
auth changes
RBAC changes
secret handling
tenant isolation
extension sandboxing
upload security
AI security
```

## Performance comparison

Compare against Phase 0 baseline.

## Test evidence

Provide exact:

```text
commands
test files
passed
failed
skipped
duration
```

## Remaining gaps

Do not hide deferred items.

## Competitive readiness

Give an evidence-based assessment of where Vibress is:

```text
stronger
equivalent
weaker
```

relative to WordPress/Ghost/headless CMS categories.

---

# 20. Execution Instruction to the Agent

**Begin implementation now.**

Do not merely rewrite this roadmap or return another plan.

Execute the phases sequentially.

For each phase:

```text
1. mark phase IN PROGRESS
2. inspect only relevant code/docs
3. implement the smallest correct architecture-consistent solution
4. add/update focused tests
5. run focused validation
6. update progress ledger
7. mark COMPLETE only after acceptance criteria pass
8. continue to the next phase
```

Do not wait for routine approvals between phases.

If a phase contains a genuinely large subsystem, break it internally into coherent batches while keeping the same phase acceptance criteria.

At major architecture decisions:

- prefer existing Vibress patterns;
- document the decision briefly in the progress ledger;
- avoid speculative frameworks;
- preserve backwards compatibility.

If credentials for external services are unavailable:

- complete the provider abstraction;
- implement a deterministic automated test adapter;
- implement the real provider integration code/config path;
- mark only the external live-credential smoke test as blocked, not the entire feature.

If a destructive operation is required:

- use disposable test data/environment;
- never execute against production data.

The task is complete only when the final report has been generated and the full final verification gate passes.

---

# Final Product Vision

The goal is not:

> "Vibress has more checkboxes than WordPress."

The goal is:

> **Vibress is the modern publishing platform teams choose because it is easier than WordPress, more capable than Ghost for collaborative teams, more integrated than headless CMS products, safer to extend, excellent in Arabic, AI-native, and genuinely pleasant to operate.**

Build toward that standard.
