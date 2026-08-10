# Automation Security

## Arbitrary Code

- Conditions are declarative data (`equals`/`not_equals`/`exists` on dotted
  paths). **No eval, no arbitrary JavaScript.**
- Actions are a fixed allowlist (email/webhook/newsletter/wait); unknown
  action types fail safely.
- Triggers are allowlisted; internal events are not exposed.

## Privilege Escalation

- Actions execute with the platform's own credentials only (SMTP, webhook
  pipeline, newsletter domain APIs) — automations never gain elevated roles
  or write other domains' tables directly.
- Manual runs require `automations.run`; definitions require
  `automations.manage`; reads require `automations.read`.

## Loop Abuse

- Depth cap (`MAX_AUTOMATION_DEPTH = 5`) stops runaway chains.
- Self-generated events carry `originAutomationId` and are skipped by the
  same automation.
- `UNIQUE(automation_id, run_key)` makes event replay idempotent.

## Duplicate Side Effects

- Completed steps are never re-executed.
- Webhook actions route through the outbound webhook pipeline with
  `UNIQUE(endpoint, event)` dedup; email actions use SMTP message IDs.

## Rate / Resource

- Search and analytics are rate limited; automation runs are bounded by
  depth and idempotent run keys.
