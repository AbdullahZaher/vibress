# Vibress — Visual Automations Comprehensive Production Audit & Forensic Report

> **Document Classification:** Engineering Architecture, Security & Production Readiness Audit  
> **Target System:** Visual Automations & Workflow Engine (`@vibress/automations`, `apps/admin`, `apps/api`, `apps/worker`, `@vibress/database`, `@vibress/queue`)  
> **Auditor:** Principal Systems Architect, Senior Product Engineer, Security Engineer & UX Auditor  
> **Audit Date:** September 21, 2026  
> **Git Baseline HEAD:** `e02104c` (Branch: `main`)  
> **Verdict:** **NOT READY** (Conditionally salvageable backend; Primary Visual UI is a mock; Webhook execution is broken; Event idempotency is defective in production)

---

## 1. Executive Summary

This report delivers a forensic production audit of the **Visual Automations** system in the Vibress monorepo. Every capability, data model, route, worker, and interface was traced to active implementation code.

### The Reality Behind the Facade

1. **The Visual Builder is a Static Client Mock:**  
   The primary route `/admin/automations` renders `VisualAutomationBuilder.tsx` (176 lines), which is an unintegrated, hardcoded React prototype. It possesses no canvas, no zoom/pan, no node drag-and-drop, no condition/action configuration drawers, no API integration, and its "Save Automation" button has **no `onClick` handler**. It does not load or save data to the backend.

2. **The Actual Admin UI is Hidden in Settings:**  
   A functional but rudimentary table and form (`AutomationsPanel.tsx`) exists inside `SettingsHub -> Growth -> IntelligenceSettings`. However, this panel hardcodes the trigger to `"comment.created"` and the action to `"webhook"`, provides no condition builder, no action selector, and renders no execution run history or logs.

3. **Critical Asynchronous Webhook Defect (P0):**  
   The worker's webhook action executor (`AutomationActionExecutor.ts`) creates a temporary webhook endpoint, enqueues an asynchronous BullMQ delivery job, and **immediately deletes the endpoint**. Because the database schema enforces `ON DELETE CASCADE` from endpoints to deliveries, the delivery record is deleted before the async delivery worker can execute it. As a result, 100% of automation webhook actions crash with `DELIVERY_NOT_FOUND`.

4. **Event Deduplication & Idempotency is Defective (P0):**  
   The backend engine relies on `payload.eventId` to construct deterministic idempotency keys (`runKey = ${triggerEvent}:${eventId}`). However, **no domain event emitted by core operations (`member.created`, `comment.created`, `subscription.activated`, etc.) includes an `eventId`**. Consequently, the system falls back to generating a random string (`Math.random()`), nullifying the unique database constraint `UNIQUE(automation_id, run_key)` and allowing 100% duplicate executions on event replays.

5. **Actions Advertised in Types and UI Crash at Runtime (P0):**  
   The domain models and the visual builder prominently showcase `"tag_add"` and `"tag_remove"`. Neither action is implemented in `AutomationActionExecutor.execute()`. Triggering either action immediately throws `Error: Unknown action type: tag_add`.

6. **BullMQ Exponential Retries are Swallowed (P0):**  
   When an action fails, `AutomationsService.executeRun` catches the error, marks the database run status as `"failed"`, and returns cleanly without rethrowing. BullMQ considers the job completed successfully, completely bypassing its configured 5 attempts and exponential backoff. Failed runs can never be automatically retried, and no API endpoint exists to manually retry them.

7. **Triggers Disconnected from the Event Bridge (P1):**  
   While `ALLOWED_TRIGGERS` advertises 9 triggers, only 5 are wired in `async-bridge.ts`. `post.published`, `page.published`, and `member.tier_changed` are completely ignored by automations.

---

## 2. Git Baseline

The audit was conducted on a clean working tree with no uncommitted changes:

- **Repository Root:** `/Users/abdullahzaher/vibress`
- **Current HEAD SHA:** `e02104c8680fa2a9a7d3a04e578c2e0b5711b7df` (`e02104c`)
- **Active Branch:** `main` (Ahead of `origin/main` by 23 commits)
- **Working Tree Status:** Clean (`nothing to commit, working tree clean`)
- **Recent Git Log (Last 5 commits):**
  - `e02104c` docs: add content modeler navigation restructure report
  - `e822542` refactor(admin): move content modeler into advanced settings
  - `5e256e7` docs: add final content modeler design parity audit report
  - `43562c7` fix(admin): resolve design parity drift in content modeler collection views
  - `4b1ea78` feat(admin): align content modeler with admin design system

---

## 3. Product Purpose

### Conceptual Purpose vs. Reality

| Question | Intended / Advertised Design | Actual Implementation Reality |
| :--- | :--- | :--- |
| **What problem does it solve?** | Visual event-driven publishing and audience growth workflows | Rudimentary automation runner for comment webhooks and email/newsletter actions |
| **Who can use it?** | Publication staff (admins, editors) | Staff with `automations.read`, `automations.manage`, `automations.run` permissions |
| **Is it publication-scoped?** | Yes, multi-tenant per publication | Partially: `automations` table is scoped, but `automation_runs` and `automation_versions` lack `publication_id` |
| **Is it staff-only?** | Yes | Yes, protected by `requireStaffSession` |
| **Can members interact with it?** | Indirectly through member events (signup, comment) | Yes, when members trigger subscribed domain events |
| **What events can trigger it?** | 9 events (posts, pages, members, subscriptions, comments) | Only 5 active events wired in `async-bridge.ts` + manual trigger via API |
| **What actions can it perform?** | Email, Webhook, Tag Add/Remove, Newsletter Subscribe/Unsubscribe, Wait | `email`, `newsletter_subscribe`, `newsletter_unsubscribe`, `wait`. (`webhook` fails at runtime; `tag_add`/`tag_remove` throw error) |
| **Execution mode?** | Asynchronous queue-based | Asynchronous via BullMQ (`vibress-automations` & `vibress-automations-delayed`) |
| **Can it modify/create content?** | No | No (no content creation/modification actions exist) |
| **Can it execute arbitrary code?** | No | No (strictly data-driven declarative evaluation; no `eval`) |

---

## 4. Data Model Audit

The automation data model is defined in `packages/database/src/schema/intelligence.ts`. In addition, an orphaned, unexported duplicate file exists at `packages/database/src/schema/automation-runs.ts`.

### Active Database Tables (`packages/database/src/schema/intelligence.ts`)

#### 1. `automations`
- **Purpose:** Stores the durable workflow definition and metadata.
- **Primary Key:** `id` (`text`)
- **Tenant Scope:** `publication_id` (`text`, NOT NULL, FK to `publications.id` ON DELETE CASCADE)
- **Columns:**
  - `id`: `text` (PK)
  - `publication_id`: `text` (FK `publications.id`)
  - `key`: `text` (unique identifier within publication)
  - `name`: `text`
  - `description`: `text` (nullable)
  - `trigger_event`: `text`
  - `conditions`: `jsonb` (default `'[]'::jsonb`)
  - `actions`: `jsonb` (default `'[]'::jsonb`)
  - `status`: `text` (default `'draft'`, enum: `'draft' | 'active' | 'inactive' | 'error'`)
  - `version`: `integer` (default 1)
  - `created_by`: `text` (FK `users.id` ON DELETE SET NULL)
  - `created_at`: `timestamp with time zone` (default `now()`)
  - `updated_at`: `timestamp with time zone` (default `now()`)
- **Constraints & Indexes:**
  - `automations_publication_key_unique`: `UNIQUE("publication_id", "key")`
  - `automations_status_trigger_idx`: `INDEX("status", "trigger_event")`

#### 2. `automation_versions`
- **Purpose:** Immutable definition snapshots for deterministic execution history.
- **Primary Key:** `id` (`text`)
- **Tenant Scope:** **MISSING `publication_id`** (Relies indirectly on parent `automation_id`).
- **Columns:**
  - `id`: `text` (PK)
  - `automation_id`: `text` (FK `automations.id` ON DELETE CASCADE)
  - `version`: `integer`
  - `definition`: `jsonb` (stores `{ conditions, actions }`)
  - `created_at`: `timestamp with time zone` (default `now()`)
- **Constraints & Indexes:**
  - `automation_versions_unique_idx`: `UNIQUE("automation_id", "version")`

#### 3. `automation_runs`
- **Purpose:** Execution instance tracking each trigger firing.
- **Primary Key:** `id` (`text`)
- **Tenant Scope:** **MISSING `publication_id`**.
- **Columns:**
  - `id`: `text` (PK)
  - `automation_id`: `text` (FK `automations.id` ON DELETE CASCADE)
  - `version`: `integer`
  - `run_key`: `text` (intended for idempotency)
  - `trigger_event`: `text`
  - `event_payload`: `jsonb`
  - `status`: `text` (default `'pending'`, enum: `'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'`)
  - `depth`: `integer` (default 0)
  - `correlation_id`: `text` (nullable)
  - `error`: `text` (nullable)
  - `started_at`: `timestamp with time zone`
  - `completed_at`: `timestamp with time zone`
  - `created_at`: `timestamp with time zone` (default `now()`)
- **Constraints & Indexes:**
  - `automation_runs_automation_idx`: `INDEX("automation_id")`
  - `automation_runs_run_key_idx`: `INDEX("run_key")`
  - `automation_runs_status_idx`: `INDEX("status")`
  - `automation_runs_unique_run_key_idx`: `UNIQUE("automation_id", "run_key")`

#### 4. `automation_run_steps`
- **Purpose:** Per-action step audit log and status machine.
- **Primary Key:** `id` (`text`)
- **Tenant Scope:** **MISSING `publication_id`** (References `run_id`).
- **Columns:**
  - `id`: `text` (PK)
  - `run_id`: `text` (FK `automation_runs.id` ON DELETE CASCADE)
  - `step_index`: `integer`
  - `action_type`: `text`
  - `status`: `text` (default `'pending'`, enum: `'pending' | 'executing' | 'completed' | 'failed' | 'waiting' | 'skipped'`)
  - `result`: `jsonb` (nullable)
  - `error`: `text` (nullable)
  - `attempts`: `integer` (default 0)
  - `executed_at`: `timestamp with time zone`
  - `created_at`: `timestamp with time zone` (default `now()`)
- **Constraints & Indexes:**
  - `automation_run_steps_unique_idx`: `UNIQUE("run_id", "step_index")`
  - `automation_run_steps_run_idx`: `INDEX("run_id")`

#### 5. Orphan Schema Anomaly: `packages/database/src/schema/automation-runs.ts`
This file contains an alternate, conflicting Drizzle definition for `automation_runs` and `automation_run_steps` featuring columns like `trigger_type`, `input`, `output`, `retry_count`, and `max_retries`. This file is **not exported in `schema/index.ts`** and has no migrations referencing it. It represents dead prototype drift.

---

## 5. Automation Definition Model

Despite visual builder UI suggesting a node-and-edge directed acyclic graph (DAG), the canonical definition in the domain and database is a **linear pipeline**:

```typescript
// Canonical definition in packages/domains/automations/src/domain/automation.ts
export interface AutomationDefinition {
  conditions: AutomationCondition[]; // Evaluated before run creation
  actions: AutomationAction[];       // Executed sequentially by stepIndex
}
```

There is **no graph representation**:
- No `nodes[]`
- No `edges[]`
- No branching (no `trueBranch` / `falseBranch`)
- No cycle detection (because the pipeline is inherently linear: step 0 -> step 1 -> step 2)

---

## 6. Visual Builder Audit

### Route & File Location
- **Route:** `/admin/automations`
- **Component File:** `apps/admin/src/components/automations/VisualAutomationBuilder.tsx` (176 lines)
- **Router Configuration:** `apps/admin/src/lib/router.tsx` (lines 61–65, 350–355)

### Deep Inspection Findings

```tsx
// VisualAutomationBuilder.tsx: Lines 11-34
export function VisualAutomationBuilder() {
  const [name, setName] = useState("New Member Welcome Flow");
  const [enabled, setEnabled] = useState(true);
  const [steps, setSteps] = useState<AutomationStep[]>([
    { id: "step_1", type: "trigger", name: "When a new member subscribes", config: { event: "member.subscribed" } },
    { id: "step_2", type: "condition", name: "If membership tier equals 'Premium'", config: { field: "tier", operator: "equals", value: "Premium" } },
    { id: "step_3", type: "action", name: "Add tag 'vip-member'", config: { actionType: "tag_add", tag: "vip-member" } },
  ]);
  // ...
  // Line 76:
  <button
    type="button"
    className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90"
  >
    <Play className="w-4 h-4" />
    Save Automation
  </button>
```

| Visual Builder Feature | Status | Evidence |
| :--- | :--- | :--- |
| **Canvas** | **MISSING** | No HTML5 canvas, SVG, or WebGL. Plain vertical `flex-col` container. |
| **Zoom / Pan / Minimap** | **MISSING** | Zero canvas manipulation libraries or controls. |
| **Node Drag / Positioning** | **MISSING** | No x/y coordinates. Static CSS array mapping. |
| **Connections / Edges** | **MOCK** | Rendered via static `<ArrowDown className="w-4 h-4" />` icons between DOM elements. |
| **Node Configuration Drawer** | **MISSING** | Clicking steps does nothing. Cards have no click handlers or detail views. |
| **Step Parameter Input** | **MISSING** | `addStep()` appends `{ name: "If condition matches", config: {} }`. No inputs exist to edit field, operator, or value. |
| **Save / Persistence** | **NON-FUNCTIONAL** | The `<button>Save Automation</button>` has **NO `onClick` handler**. It does literally nothing. |
| **API Integration** | **DISCONNECTED** | Does not import `apiRequest` or any methods from `apps/admin/src/lib/api`. |
| **Run History / Logs** | **MISSING** | No execution logs, run history, or run triggers present. |

---

## 7. Triggers

The domain code defines an explicit trigger allowlist in `packages/domains/automations/src/domain/automation.ts`. However, actual implementation differs significantly:

| Trigger Event | Domain Allowlist | Emitted in Codebase | Wired to Automations Bridge | Execution Status |
| :--- | :---: | :---: | :---: | :--- |
| `member.created` | Yes | Yes (`member-auth-service.ts`) | Yes (`async-bridge.ts:149`) | **ACTIVE** |
| `member.tier_changed` | Yes | **NO** (Never emitted) | **NO** | **DEAD CODE** |
| `subscription.activated` | Yes | Yes (`subscriptions-service.ts`) | Yes (`async-bridge.ts:150`) | **ACTIVE** |
| `subscription.cancelled` | Yes | Yes (`subscriptions-service.ts`) | Yes (`async-bridge.ts:151`) | **ACTIVE** |
| `newsletter.sent` | Yes | Yes (`newsletters-service.ts`) | Yes (`async-bridge.ts:152`) | **ACTIVE** |
| `comment.created` | Yes | Yes (`comments-service.ts`) | Yes (`async-bridge.ts:153`) | **ACTIVE** |
| `post.published` | Yes | Yes (`posts-service.ts`) | **NO** (Only wired to Search) | **DISCONNECTED** |
| `page.published` | Yes | **NO** (Audit log only) | **NO** | **DISCONNECTED** |
| `manual` | Yes | Yes (API route `/run`) | Direct API Call | **ACTIVE** |

---

## 8. Actions

The action execution logic is split between `AutomationsService.executeRun()` (which handles `wait`) and `AutomationActionExecutor.execute()` in `apps/worker/src/processors/automation-action-executor.ts`.

| Action Type | Allowed in Types | Implemented in Worker | Status & Critical Failure Analysis |
| :--- | :---: | :---: | :--- |
| `email` | Yes | Yes | **PARTIAL**: Sends email via SMTP provider. HTML-escapes body. Lacks retry deduplication at provider level. |
| `webhook` | Yes | Yes | **BROKEN (P0)**: Creates transient endpoint, enqueues BullMQ job, and immediately deletes endpoint. Because of `ON DELETE CASCADE`, Postgres deletes `webhook_deliveries` row before worker runs. Delivery crashes with `DELIVERY_NOT_FOUND`. |
| `newsletter_subscribe` | Yes | Yes | **VERIFIED**: Calls `newsletterPrefRepo.setSubscription(memberId, newsletterId, true)`. |
| `newsletter_unsubscribe` | Yes | Yes | **VERIFIED**: Calls `newsletterPrefRepo.setSubscription(memberId, newsletterId, false)`. |
| `wait` | Yes | Yes | **VERIFIED**: Updates step and run status to `'waiting'` and enqueues BullMQ delayed job on `vibress-automations-delayed`. Resumes cleanly across worker restarts. |
| `tag_add` | Yes | **NO** | **FATAL (P0)**: Advertised in UI and domain types, but absent in `AutomationActionExecutor`. Throws `Unknown action type: tag_add`. |
| `tag_remove` | Yes | **NO** | **FATAL (P0)**: Throws `Unknown action type: tag_remove`. |

---

## 9. Conditions & Branching

### Evaluation Implementation
Conditions are evaluated in `packages/domains/automations/src/application/automations-service.ts`:

```typescript
export function evaluateConditions(
  conditions: AutomationCondition[],
  payload: Record<string, unknown> | null,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  const data = payload || {};
  for (const condition of conditions) {
    const value = resolveField(data, condition.field);
    switch (condition.op) {
      case "equals":
        if (value !== condition.value) return false;
        break;
      case "not_equals":
        if (value === condition.value) return false;
        break;
      case "exists":
        if (value === undefined || value === null) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}
```

### Analysis
1. **No Runtime Branching:** Conditions are strictly a **pre-run filter**. They are evaluated inside `handleEvent()` before creating an `automation_runs` record. If conditions fail, no run is created. They cannot steer execution down alternative paths.
2. **Operators:** Only 3 operators exist (`equals`, `not_equals`, `exists`).
3. **Missing Operators:** No `contains`, `starts_with`, `>`, `<`, `>=`, `<=`, `in`, or regex.
4. **Logical Combination:** Strictly `AND`. No `OR` support, no nested condition groups.
5. **Strict Equality Pitfall:** Uses JavaScript `!==`. If an event payload contains `"tier": 1` and condition expects `"1"`, condition fails due to strict equality with no type coercion.

---

## 10. Execution Engine

### End-to-End Execution Trace

```
1. Core Domain Operation (e.g. member signs up)
   │
2. domainEvents.emit("member.created", { memberId: "...", publicationId: "..." })
   │
3. apps/api/src/async-bridge.ts listener receives event
   │
4. automationsService.handleEvent("member.created", payload)
   ├─ Checks recursion depth (depth >= 5 -> skip)
   ├─ Finds active automations: repo.listActiveByTrigger("member.created", pubId)
   ├─ Evaluates conditions: evaluateConditions(automation.conditions, payload)
   ├─ Computes runKey: (eventId is undefined -> generates RANDOM runKey!)
   ├─ Inserts automation_runs (status: 'pending')
   └─ Enqueues BullMQ job: 'run' on queue 'vibress-automations'
   │
5. apps/worker/src/processors/automation-runner-worker.ts
   │  Worker picks up job { runId, publicationId }
   │
6. automationsService.executeRun(runId)
   ├─ Loads run: repo.findRunById(runId)
   ├─ Loads immutable definition: repo.getVersion(run.automationId, run.version)
   ├─ Updates run status -> 'running'
   ├─ Loops through definition.actions:
   │  ├─ Checks if step already 'completed' (idempotency within run)
   │  ├─ If action == 'wait':
   │  │    Updates step -> 'waiting', run -> 'waiting'
   │  │    Enqueues delayed BullMQ job on 'vibress-automations-delayed'
   │  │    Returns (pauses execution cleanly)
   │  ├─ If action != 'wait':
   │  │    Updates step -> 'executing', increments attempts
   │  │    Calls executor.execute(action, context)
   │  │    Updates step -> 'completed' with result
   │  └─ If action fails:
   │       Updates step -> 'failed', throws error
   │
   ├─ [On Action Failure]:
   │    Catches error, updates run -> 'failed'
   │    SWALLOWS ERROR (does not rethrow!)
   │    BullMQ considers job complete! No retry!
   │
   └─ [On Success]:
        Updates run -> 'completed' (completedAt = now())
```

---

## 11. Queue & Worker Architecture

### BullMQ Topology

| Queue Name | Worker Processor | Concurrency | Job Options | Purpose |
| :--- | :--- | :---: | :--- | :--- |
| `vibress-automations` | `AutomationRunnerWorker` | 2 | `attempts: 5`, `backoff: exponential (5s)`, `removeOnComplete: 1000`, `removeOnFail: 2000` | Primary run step execution |
| `vibress-automations-delayed` | `AutomationRunnerWorker` | 2 | `attempts: 5`, `backoff: exponential (5s)`, `removeOnComplete: 1000`, `removeOnFail: 2000` | Resuming runs after `wait` delays |

### Scoping Verification
All jobs enqueued use `enqueueTraced()` and include `assertJobScope()` in the worker processor, ensuring that `scope: "publication"` and `publicationId` are present in job metadata.

---

## 12. Idempotency & Duplicate Execution

### Idempotency Classification: **PARTIAL / CRITICALLY DEFECTIVE**

The system provides two distinct levels of idempotency with starkly different realities:

#### Level 1: Event-Level Deduplication (BROKEN)
- **Design Intent:** An incoming domain event should only trigger an automation once. Idempotency is enforced by `UNIQUE(automation_id, run_key)`.
- **Actual Reality:**
  ```typescript
  // automations-service.ts: lines 280-285
  const eventId = payload?.eventId ? String(payload.eventId) : undefined;
  const runKey = eventId
    ? `${triggerEvent}:${eventId}`
    : `${triggerEvent}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const existing = await this.repo.findRun(automation.id, runKey);
  if (existing) continue;
  ```
  In production, core events (`member.created`, `comment.created`, etc.) **never contain `eventId`**. Every single event arrival produces a random `runKey`. Duplicate event emissions produce duplicate runs 100% of the time.

#### Level 2: Step-Level Execution Within a Run (STRONG)
- **Design Intent & Reality:** Within an existing run, steps marked as `'completed'` are skipped during re-execution:
  ```typescript
  if (step.status === "completed") continue;
  ```
  If a worker process restarts during a wait or crashes, completed steps are not re-executed. However, if a crash occurs between the execution of an external side effect (e.g. SMTP send) and the database write marking the step `'completed'`, the side effect will be duplicated on worker recovery.

---

## 13. Retry, Failure & Recovery

| Failure Scenario | Engine Behavior | Recovery Mechanism |
| :--- | :--- | :--- |
| **Action Throws Transient Error** | Step marked `'failed'`, run marked `'failed'`. Error caught in `executeRun()`. No rethrow. | **FATAL**: BullMQ thinks job succeeded. No automatic retries occur. Run remains permanently failed. |
| **External API Timeout (e.g. SMTP)** | Step marked `'failed'`, run marked `'failed'`. | Permanently failed. No retry. |
| **Worker Process Crash (SIGKILL / OOM)** | Run remains in `'running'`, step remains in `'executing'`. | Stalled job detected by BullMQ lock renewal timeout; re-executed on restart. Step re-runs. |
| **Wait Step Interruption / Restart** | Step in `'waiting'`, run in `'waiting'`. | **EXCELLENT**: BullMQ delayed job survives Redis/worker restarts. Resumes cleanly when timer fires. |
| **Manual Retry via API** | Service method `retryRun(runId)` exists in domain. | **UNAVAILABLE**: No HTTP route in `apps/api` exposes `retryRun`. Admins cannot trigger manual retries. |

---

## 14. Graph Safety

- **Maximum Recursion Depth:** Enforced by `MAX_AUTOMATION_DEPTH = 5`.
- **Maximum Action Count:** Enforced by `MAX_ACTIONS = 10` on creation.
- **Self-Trigger Prevention:** In `handleEvent()`:
  ```typescript
  const originAutomationId = payload?.originAutomationId;
  if (originAutomationId === automation.id) continue;
  ```
  Prevents an automation from triggering itself in an infinite loop.
- **Cycle Detection:** Not applicable, as the execution engine only supports linear sequential pipelines.

---

## 15. Security Audit

### 1. Authentication & RBAC
- All endpoints are protected by `requireStaffSession`.
- Granular permissions enforced:
  - `automations.read`: Required for list automations, list runs, view steps.
  - `automations.manage`: Required for create, update, activate, deactivate.
  - `automations.run`: Required for manual test runs.
- Origin validation (`validateOrigin`) enforced on all mutation requests (`POST`, `PATCH`), preventing CSRF.

### 2. SSRF Protection (Webhook Action)
- `safeFetch()` in `@vibress/security` uses DNS pre-resolution, pins sockets, normalizes IPv6, and blocks private/reserved IP ranges (`10.0.0.0/8`, `127.0.0.0/8`, `169.254.169.254`, `metadata.google.internal`, etc.).
- However, as identified in finding P0-1, the webhook delivery pipeline currently cascade-deletes the delivery record before `safeFetch()` is ever reached.

### 3. Arbitrary Code Execution
- Evaluator is strictly declarative (`field`, `op`, `value`). No `eval()`, `new Function()`, or script engines exist.

### 4. Secret Storage
- Automation definitions store no secrets directly. Webhook action ephemeral endpoints pass `secret: null`.

---

## 16. Publication Isolation Audit

| Boundary | Level | Status | Evaluation & Evidence |
| :--- | :--- | :---: | :--- |
| **Automation Reads** | API & Repo | **PASS** | `repo.list(pubId)` and `repo.findById(id, pubId)` strictly enforce publication filter. Verified in `automations-isolation.test.ts`. |
| **Automation Creates** | API & Repo | **PASS** | Insert enforces `publicationId`. Composite unique index `(publication_id, key)` prevents collisions. |
| **Automation Updates** | API & Repo | **PASS** | Update queries include `AND publication_id = $pubId`. Cross-tenant updates return 404 / throw. |
| **Automation Deletes** | API & Repo | **N/A** | Deletion is not implemented anywhere in the system. |
| **Execution Triggering** | Domain | **PASS** | `listActiveByTrigger(event, pubId)` strictly scopes event matching to the event's publication ID. |
| **Run History Reads** | API & Repo | **PASS** | `listRuns` with `publicationId` joins `automations` table to filter by `automations.publicationId`. |
| **Single Run by ID** | Repo & Domain | **FAIL** | `findRunById(id)` and `getRunDetails(id)` execute **without publication scoping**. Potential cross-tenant data leak if run ID is known. |
| **Run & Version DB Schema** | Database | **FAIL** | Neither `automation_runs` nor `automation_versions` contains a `publication_id` column. They rely solely on cascaded foreign keys from `automations`. |

---

## 17. API Inventory

All routes are registered in `apps/api/src/routes/intelligence.ts` under prefix `/api/admin/v1`:

| Method | Path | Auth & Permission | Origin Check | Status | Missing / Anomaly |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `GET` | `/automations` | `requireStaffSession`, `automations.read` | No | Implemented | Returns array of automations for tenant |
| `POST` | `/automations` | `requireStaffSession`, `automations.manage` | Yes | Implemented | Creates automation & v1 snapshot |
| `PATCH` | `/automations/:id` | `requireStaffSession`, `automations.manage` | Yes | Implemented | Updates automation & snapshots new version |
| `POST` | `/automations/:id/activate` | `requireStaffSession`, `automations.manage` | Yes | Implemented | Sets status to `'active'` |
| `POST` | `/automations/:id/deactivate` | `requireStaffSession`, `automations.manage` | Yes | Implemented | Sets status to `'inactive'` |
| `POST` | `/automations/:id/run` | `requireStaffSession`, `automations.run` | Yes | Implemented | Triggers immediate manual run |
| `GET` | `/automation-runs` | `requireStaffSession`, `automations.read` | No | Implemented | Lists runs with status/pagination filters |
| `GET` | `/automation-runs/:id/steps` | `requireStaffSession`, `automations.read` | No | Implemented | Lists execution steps for a run |
| `GET` | `/automations/:id` | — | — | **MISSING** | No endpoint to fetch a single automation |
| `DELETE` | `/automations/:id` | — | — | **MISSING** | No endpoint to delete an automation |
| `POST` | `/automation-runs/:id/retry`| — | — | **MISSING** | Domain has `retryRun`, but no API exposes it |

---

## 18. Admin UX & Design System Audit

### Comparison: VisualAutomationBuilder vs. Vibress Admin Design System

| Dimension | Vibress Admin Design System | VisualAutomationBuilder (`/admin/automations`) | AutomationsPanel (Settings -> Growth) |
| :--- | :--- | :--- | :--- |
| **Component Primitives** | Canonical `@vibress/ui` (`Button`, `Card`, `Input`, `Badge`, `Table`) | **Zero canonical components**. Raw `<button>`, `<input>`, `<div>`. | Uses `@vibress/ui` (`Button`, `Card`, `Input`, `Table`, `Badge`). |
| **Typography** | Inter/Geist variables (`text-foreground`, `font-semibold`) | Ad-hoc font sizes (`text-[11px] font-bold`) | Conforms to Admin typography. |
| **Color Tokens** | HSL CSS variables (`bg-card`, `border-border`, `text-primary`) | Mixed hardcoded classes (`bg-amber-100`, `text-amber-600`) | Conforms to semantic tokens. |
| **Navigation** | Dedicated sidebar link with `Zap` icon | Linked directly to `/admin/automations` | Buried in Settings -> Growth -> Intelligence. |
| **State Feedback** | Loading skeletons, empty states, error banners | **None**. Hardcoded static state. | Basic table empty state. |

---

## 19. UX Quality & Builder Clarity

- **Discoverability:** High in sidebar, but leads to an unusable dummy mock. The working panel is deeply buried in settings.
- **Builder Clarity:** The vertical flowchart layout in `VisualAutomationBuilder` is visually clean as a concept, but because steps cannot be clicked or edited, it provides zero functional utility.
- **Execution Feedback:** Completely absent in `VisualAutomationBuilder`. In `AutomationsPanel`, triggering a test displays a temporary success toast, but does not display run status or step output.
- **Safety:** Destructive actions have no confirmation dialogs.

---

## 20. Localization & RTL Audit

- **Dictionary Entries:** Searching `packages/i18n` reveals **ZERO localization keys** for automations in either English (`en.ts`) or Arabic (`ar.ts`).
- **RTL Support:** `VisualAutomationBuilder.tsx` contains no RTL logical classes (`ms-`, `me-`, `text-start`). In Arabic mode, text remains in English.
- **Sidebar Label:** In `NavContent.tsx`, the sidebar link `<span>Automations</span>` is hardcoded in English, bypassing `useTranslation()`.

---

## 21. Responsive Audit

- **320px – 430px (Mobile):** The top toolbar in `VisualAutomationBuilder` overflows or wraps into multi-line fragments. Step action buttons (`Add Filter Condition`, `Add Action`) wrap awkwardly.
- **768px – 1024px (Tablet):** Layout is centered in `max-w-4xl` and displays passably.
- **1280px+ (Desktop):** Display is stable.
- **Verdict:** **PARTIALLY RESPONSIVE** (Only because it is a simple vertical flex list, not a true 2D canvas).

---

## 22. Accessibility (WCAG 2.2 AA)

- **Keyboard Navigation:** Steps cannot be selected, navigated, or reordered via keyboard.
- **Accessible Names:** The delete step button `<button onClick={() => removeStep(step.id)}><Trash2 className="w-4 h-4" /></button>` has **no `aria-label`**. Screen readers announce an unlabelled button.
- **Decorative SVGs:** Decorative connection arrows `<ArrowDown className="w-4 h-4" />` lack `aria-hidden="true"`.
- **Status Announcements:** Toggle active/paused checkbox has no `aria-checked` or role indicators.

---

## 23. Observability

- **Distributed Tracing:** OpenTelemetry spans wrap worker processors (`worker.job.automation-run`, `worker.job.automation-resume`) via `tracedProcessor()`.
- **Structured Logs:** Worker logs job failures to console with error messages and job IDs.
- **Execution History:** Stored in `automation_runs` and `automation_run_steps`.
- **Metrics:** Execution metrics are not individually exported to Prometheus (no `automation_runs_total` or `automation_duration_seconds` counters).

---

## 24. Performance Analysis

- **Sequential Execution:** Actions execute strictly in sequence. A slow SMTP connection blocks subsequent actions in the run.
- **Wait Durability:** The `wait` action is highly efficient: it does not hold open Node.js memory timers or worker threads. It marks the run `'waiting'` and schedules a BullMQ delayed job in Redis, freeing worker capacity.
- **Payload Bloat:** Event payloads are stored directly as `jsonb` in `automation_runs`. Unbounded large event payloads could inflate database storage over time without a retention policy.

---

## 25. Test Coverage Inventory

### Existing Automated Tests (All Passing)
1. `packages/domains/automations/tests/automations-service.test.ts` (18 tests): Unit tests for condition evaluation, CRUD, versions, wait scheduling, and loop depth capping. (Uses mocked repository and dispatcher).
2. `packages/domains/automations/src/__tests__/automations.test.ts` (3 tests): Dotted condition evaluation and trigger event matching.
3. `packages/domains/automations/src/__tests__/automations-isolation.test.ts` (5 tests): Multi-publication isolation verifying cross-tenant queries return null.
4. `apps/api/src/__tests__/intelligence-api.test.ts` (7 tests): API route tests for CRUD, trigger validation, activation, run history, and CSRF origin checks.
5. `tests/e2e/intelligence.test.ts` (2 tests): End-to-end tests for comment trigger run creation and durable wait resumption.
6. `tests/integration/runtime-multi-publication-isolation.test.ts` (1 test): Verifies publication beta cannot list publication alpha's automations.

### Critical Untested Scenarios (Gaps)
- **ZERO tests for `AutomationActionExecutor`** (webhook delivery, email sending, tag crash).
- **ZERO tests for `AutomationRunnerWorker`**.
- **ZERO frontend component tests** for `VisualAutomationBuilder` or `AutomationsPanel`.
- **ZERO tests for event idempotency** with realistic domain event payloads lacking `eventId`.

---

## 26. Documentation Audit

Contradictions between documentation and implementation:

1. `docs/03-domains/automations.md` states: *"Retries: BullMQ attempts (5, exponential backoff)"*.  
   **Reality:** `executeRun()` swallows errors; BullMQ never retries.
2. `docs/roadmap/vibress-master-plan-progress.md` claims: *"✅ Event triggers (member.created, member.subscribed, member.tier_changed, post.published, page.published, tag.added)"*.  
   **Reality:** `member.tier_changed`, `post.published`, and `page.published` do not trigger automations; `tag.added` does not exist.
3. `docs/06-security/automation-security.md` claims: *"UNIQUE(endpoint, event) dedup"* for webhooks.  
   **Reality:** Webhook action creates and deletes a temporary endpoint in the same tick, cascade-deleting deliveries.

---

## 27. Production Readiness Matrix

| Major Subsystem | Status | Summary |
| :--- | :---: | :--- |
| **Domain Architecture** | **PARTIALLY VERIFIED** | Solid state machine, version snapshots, and durable waits; linear pipeline only. |
| **Data Model** | **PARTIALLY VERIFIED** | Tables indexed and constrained, but `runs` and `versions` lack `publication_id`. Orphan duplicate file exists. |
| **API Surface** | **PARTIALLY VERIFIED** | Core CRUD present, but missing single GET, DELETE, and manual RETRY endpoints. |
| **Visual Builder UI** | **MISSING** | Route `/admin/automations` is a client-only static mock with non-functional buttons. |
| **Settings Automations Panel** | **PARTIALLY VERIFIED** | Functions for creating basic webhooks, but hardcoded and lacks run history. |
| **Triggers** | **PARTIALLY VERIFIED** | 5 triggers work; 4 triggers advertised are completely disconnected. |
| **Actions** | **NOT VERIFIED / BROKEN**| Webhook action fails 100% due to cascade delete; Tag actions throw runtime errors. |
| **Conditions** | **VERIFIED** | Declarative evaluation works as a pre-run filter; no runtime branching. |
| **Execution Engine** | **PARTIALLY VERIFIED** | Sequential step runner works, but error swallowing breaks worker retries. |
| **Queue / Workers** | **VERIFIED** | BullMQ setup and scoping are solid. |
| **Idempotency** | **NOT VERIFIED / DEFECTIVE**| Real domain events lack `eventId`, causing random keys and 0% deduplication. |
| **Retry & Recovery** | **NOT VERIFIED / DEFECTIVE**| Worker does not retry on action failure; no retry API endpoint. |
| **Security** | **VERIFIED** | Strong RBAC, CSRF, and SSRF prevention. |
| **Publication Isolation** | **PARTIALLY VERIFIED** | Strong at definition layer, leaky on single run lookups. |
| **Observability** | **PARTIALLY VERIFIED** | OpenTelemetry spans present; Prometheus metrics absent. |
| **Localization & RTL** | **MISSING** | Zero translation keys; English-only hardcoded strings. |
| **Accessibility** | **NOT VERIFIED** | Missing accessible labels on icon buttons; no keyboard navigation. |
| **Testing** | **PARTIALLY VERIFIED** | Good domain unit tests; 0 worker processor tests; 0 UI tests. |

---

## 28. Critical Findings by Severity

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         FINDINGS SEVERITY BREAKDOWN                        │
├───────────────────┬────────────────────────────────────────────────────────┤
│ P0 (Blocker)      │ 5 Critical architectural, execution, and UI blockers   │
│ P1 (Major Risk)   │ 5 Major isolation, trigger, and lifecycle risks        │
│ P2 (Significant)  │ 5 Significant UX, localization, and schema issues      │
│ P3 (Improvement)  │ 4 Polish, design system, and accessibility items       │
│ P4 (Nice to have) │ 3 Canvas and preview enhancements                      │
└───────────────────┴────────────────────────────────────────────────────────┘
```

### P0 — Critical Production Blockers

#### [P0-1] Webhook Action Delivery Cascade-Delete Race (100% Async Failure)
- **Component:** `apps/worker/src/processors/automation-action-executor.ts` (lines 89–114)
- **Impact:** All webhook actions fail asynchronously with `DELIVERY_NOT_FOUND`.
- **Evidence:** `execute()` creates a transient webhook endpoint, calls `dispatchEvent()`, and immediately calls `deleteEndpoint()`. The database foreign key `webhook_deliveries.endpoint_id` has `ON DELETE CASCADE`. When `WebhookDeliveryWorker` processes the delivery job, the record has already been wiped out.
- **Remediation:** Remove transient endpoint creation. Directly execute outbound webhook deliveries through `safeFetch()` or retain persistent webhook endpoints dedicated to automations.

#### [P0-2] Production Event Deduplication / Idempotency is Broken
- **Component:** `packages/domains/automations/src/application/automations-service.ts` (lines 280–284)
- **Impact:** Replayed or duplicate domain events generate duplicate automation runs, resulting in duplicate emails and charges.
- **Evidence:** `handleEvent` expects `payload?.eventId`. No core domain event payload (`member.created`, `comment.created`, etc.) includes `eventId`. The code falls back to `Math.random()`, bypassing the `UNIQUE(automation_id, run_key)` constraint.
- **Remediation:** In `event-map.ts` and `domainEvents.emit()`, ensure every emitted event includes an immutable `eventId`, or generate a deterministic `runKey` using `triggerEvent + entityId + entityVersion`.

#### [P0-3] Primary Visual Automation Builder is an Unconnected Static Mock
- **Component:** `apps/admin/src/components/automations/VisualAutomationBuilder.tsx`
- **Impact:** Navigating to "Automations" in the sidebar displays an interactive mock where saving does nothing and no real automations can be viewed or configured.
- **Evidence:** 176 lines of self-contained local state; no API client imports; "Save Automation" button has no `onClick` handler.
- **Remediation:** Replace or overhaul `VisualAutomationBuilder` to integrate with `apps/admin/src/lib/api/intelligence.ts`, support real trigger/condition/action configuration panels, and save definitions to the API.

#### [P0-4] Advertised Tag Actions Throw Unhandled Runtime Errors
- **Component:** `apps/worker/src/processors/automation-action-executor.ts`
- **Impact:** Automations with `tag_add` or `tag_remove` immediately crash the runner worker.
- **Evidence:** `tag_add` is the default action showcased in the visual builder, but `AutomationActionExecutor` has no case for it and hits `default: throw new Error("Unknown action type")`.
- **Remediation:** Implement tag management via `DrizzleTagRepository` in `AutomationActionExecutor`, or remove tag actions from allowed types and UI.

#### [P0-5] BullMQ Automatic Retries are Swallowed on Action Failures
- **Component:** `packages/domains/automations/src/application/automations-service.ts` (lines 416–423)
- **Impact:** Transient network failures cause runs to fail permanently with 0 BullMQ retries.
- **Evidence:** Outer `try/catch` in `executeRun()` catches action failure, updates status to `'failed'`, and does not rethrow. BullMQ worker marks the job completed.
- **Remediation:** Rethrow unhandled transient errors from `executeRun()` so BullMQ's exponential backoff retry loop can function as designed.

---

### P1 — Major Production Risks

#### [P1-1] Triggers Disconnected from Async Bridge
- **Component:** `apps/api/src/async-bridge.ts` (lines 148–154)
- **Impact:** Automations configured for `post.published`, `page.published`, or `member.tier_changed` never execute.
- **Remediation:** Add listeners for `post.published` and `page.published` in `async-bridge.ts` and ensure `pages-service.ts` emits `page.published`.

#### [P1-2] Tenant Isolation Gaps in Runs and Versions
- **Component:** `packages/database/src/schema/intelligence.ts` & `drizzle-automation-repositories.ts`
- **Impact:** `automation_runs` and `automation_versions` lack `publication_id` columns. `findRunById` and `getRunDetails` execute unscoped lookups.
- **Remediation:** Add `publication_id` column to `automation_runs` and `automation_versions` with NOT NULL constraints, and require `publicationId` on `findRunById`.

#### [P1-3] Absence of Automation Deletion Lifecycle
- **Component:** `packages/domains/automations/src/domain/repository.ts` & `apps/api/src/routes/intelligence.ts`
- **Impact:** Automations can never be deleted, causing database accumulation.
- **Remediation:** Add `delete(id, publicationId)` to `AutomationRepository` and `DELETE /api/admin/v1/automations/:id` to API.

#### [P1-4] Zero Worker Processor Test Coverage
- **Component:** `apps/worker/tests/`
- **Impact:** Critical execution paths in `AutomationRunnerWorker` and `AutomationActionExecutor` are completely untested.
- **Remediation:** Add integration tests for `AutomationRunnerWorker` and `AutomationActionExecutor`.

#### [P1-5] Missing API Endpoints for Single Get and Manual Retry
- **Component:** `apps/api/src/routes/intelligence.ts`
- **Impact:** Admins cannot inspect a single automation by ID or retry failed runs.
- **Remediation:** Add `GET /api/admin/v1/automations/:id` and `POST /api/admin/v1/automation-runs/:id/retry`.

---

## 29. Architecture Diagram

```
                              ACTUAL RUNTIME ARCHITECTURE
                              ───────────────────────────

    [ Client Admin UI ]
           │
           ├─► /admin/automations ────────► VisualAutomationBuilder.tsx  (MOCK - DISCONNECTED)
           │
           └─► Settings > Growth ─────────► AutomationsPanel.tsx         (ACTIVE - RESTRICTED)
                                                   │
                                                   ▼ HTTP (REST)
    [ API Gateway (Fastify) ] ──────────────► /api/admin/v1/automations
                                                   │
    [ Core Domain Events ]                         ▼
    (members, comments, billing) ──► apps/api/src/async-bridge.ts
                                                   │
                                                   ▼
                                     automationsService.handleEvent()
                                     ├─ evaluateConditions()  [Pre-Run Filter]
                                     ├─ Compute runKey        [DEFECTIVE: Random Key!]
                                     └─ repo.createRun()      [DB: automation_runs]
                                                   │
                                                   ▼ enqueueTraced()
    [ BullMQ / Redis ] ────────────────► Queue: "vibress-automations"
                                                   │
                                                   ▼
    [ Worker Process ] ────────────────► AutomationRunnerWorker
                                                   │
                                                   ▼
                                     automationsService.executeRun()
                                                   │
                      ┌────────────────────────────┴───────────────────────────┐
                      │                                                        │
                      ▼                                                        ▼
             [ Action: "wait" ]                                      [ Normal Actions ]
                      │                                                        │
         Update step -> 'waiting'                                              ▼
         Enqueue delayed BullMQ job                           AutomationActionExecutor.execute()
         Queue: "vibress-automations-delayed"                                  │
                      │                                   ┌────────────────────┼────────────────────┐
                      ▼                                   ▼                    ▼                    ▼
             Worker resumes via                     Action: "email"    Action: "webhook"     Action: "tag_add"
             resumeRun(runId)                        (SMTP Client)     (Ephemeral Endpoint)  (CRASH: Throws!)
                                                          │                    │
                                                          │                    ▼
                                                          │            deleteEndpoint()
                                                          │                    │
                                                          │                    ▼
                                                          │            CASCADE DELETE
                                                          │            Delivery row wiped!
                                                          ▼                    │
                                                     [ SUCCESS ]               ▼
                                                                        [ WORKER CRASH ]
                                                                       DELIVERY_NOT_FOUND
```

---

## 30. Recommended Remediation Plan

### Phase 1: Critical Reliability & Security Fixes (Immediate)
1. **Fix Webhook Action Execution:**
   - In `apps/worker/src/processors/automation-action-executor.ts`, bypass the ephemeral `webhook_endpoints` create/delete cycle. Directly execute the HTTP delivery via `safeFetch()`, record the response, and store it in `automation_run_steps.result`.
2. **Fix Event Deduplication (Idempotency):**
   - Update `packages/events` to ensure all emitted domain events include a canonical `eventId` (UUID). Update `automations-service.ts` to require `payload.eventId` or generate a deterministic composite key (`${triggerEvent}:${payload.memberId || payload.commentId || payload.id}`).
3. **Fix Worker Error Rethrowing:**
   - In `automations-service.ts:executeRun()`, rethrow transient errors so BullMQ triggers its configured 5 attempts and exponential backoff.
4. **Implement Missing Actions or Remove from Types:**
   - Implement `tag_add` and `tag_remove` in `AutomationActionExecutor` using `DrizzleTagRepository`, or remove them from `ALLOWED_ACTIONS`.

### Phase 2: Multi-Publication Hardening & API Completion
1. **Add `publication_id` to Runs and Versions:**
   - Create a database migration adding `publication_id` to `automation_runs` and `automation_versions`. Enforce tenant checks on `findRunById` and `getRunDetails`.
2. **Expose Missing API Endpoints:**
   - Add `GET /api/admin/v1/automations/:id`.
   - Add `DELETE /api/admin/v1/automations/:id`.
   - Add `POST /api/admin/v1/automation-runs/:id/retry`.
3. **Connect Missing Triggers:**
   - Wire `post.published` and `page.published` in `async-bridge.ts`.

### Phase 3: Admin UI Overhaul
1. **Unify the Builder UI:**
   - Connect `/admin/automations` (`VisualAutomationBuilder.tsx`) to real API endpoints.
   - Implement configuration forms for triggers, conditions, and actions.
   - Wire the "Save Automation" button.
2. **Expose Run History & Debugging:**
   - Render a runs table and step drawer in the admin UI showing execution timestamps, status badges, and error diagnostics.
3. **Localization & Accessibility:**
   - Add translation keys to `packages/i18n` for Arabic and English.
   - Implement accessible labels (`aria-label`) on icon buttons and keyboard navigation for steps.

---

## 31. Final Verdict

### Verdict: **NOT READY**

**Rationale:**  
While the core domain concepts (immutable versions, sequential step audit trail, and durable queue-backed waits) are architecturally promising, the system cannot be deployed to production in its current state. The visual builder visible to users is an unintegrated static prototype that cannot save data; webhooks fail 100% of the time due to a cascade-deletion flaw; event deduplication is non-functional; tag actions crash the worker; and BullMQ retries are swallowed. Addressing the Phase 1 remediation plan is required before Visual Automations can be certified for production.
