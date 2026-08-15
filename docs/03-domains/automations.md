# Automations

## Model

Durable definitions + immutable versions + run history:

- `automations` — key, name, trigger_event, conditions, actions, status,
  version.
- `automation_versions` — immutable snapshots (`UNIQUE(automation_id,
version)`); runs reference a specific version so active definitions never
  mutate under existing runs.
- `automation_runs` — run state with `UNIQUE(automation_id, run_key)`
  (idempotency) and `depth` (loop prevention).
- `automation_run_steps` — per-step state with `UNIQUE(run_id, step_index)`.

## Triggers (safe allowlist)

`member.created`, `subscription.activated`, `subscription.cancelled`,
`newsletter.sent`, `comment.created`, `manual`. Internal events are not
exposed automatically.

## Conditions

Declarative, data-only: `{ field, op: equals|not_equals|exists, value }`.
Dotted field paths resolve from the event payload. **No eval, no arbitrary
JavaScript.**

## Actions

`email`, `webhook`, `newsletter_subscribe`, `newsletter_unsubscribe`,
`wait`. The executor delegates to domain services (Email, Webhooks,
Newsletters) — the automation domain never writes another domain's tables
directly.

## Durable Wait

`wait` actions persist the run as `waiting`, mark the step `waiting`, and
schedule a delayed BullMQ job. On resume, the waiting step is marked
completed and execution continues. No in-memory timers — restarts are safe.

## Run States

`pending → running → waiting → completed / failed / cancelled`. Step state
and errors are persisted for inspection.

## Idempotency / Retry

- `run_key` is stable per event identity — duplicate events create one run.
- Completed steps are never re-executed (retries cannot duplicate email/
  webhook/subscription side effects).
- Failed runs are inspectable with error + attempts.

## Loop Prevention

- Depth cap (`MAX_AUTOMATION_DEPTH = 5`).
- Self-generated events (`originAutomationId`) never re-trigger the same
  automation.
- Idempotent run keys stop duplicate event retriggering.

## Admin

`automations.read`, `automations.manage`, `automations.run`. Manual/test runs
require an active automation.
