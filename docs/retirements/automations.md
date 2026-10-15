# Automations retirement

The Visual Automations feature was removed from the admin app, admin API,
domain package, event dispatch bridge, background workers, Redis queue names,
permission seeds, and active TypeScript models. Analytics, search and other
background processors remain supported.

## Breaking public contracts

The retired `/admin/automations` route and
`/api/admin/v1/automations*` / `/api/admin/v1/automation-runs*`
admin APIs are no longer exposed. Existing integrations must stop calling them.
They now return 404. This removal is intentional and is not replaced with
a compatibility endpoint that might execute retired workflows.

## Upgrade and data integrity

Published migrations are not rewritten. Historical database tables
(`automations`, `automation_versions`, `automation_runs`, and
`automation_run_steps`) and existing customer records are retained on both
upgrades and fresh installs. They are no longer read or written by supported
runtime code. Migration 0037 removes the old `automations.read`,
`automations.manage`, and `automations.run` grants/permissions only.

To delete historical records permanently, operators must choose and verify
a separately approved backup/retention and destructive cleanup procedure.
This feature retirement deliberately does not silently delete customer data.

Deploy new API and worker together and drain old workers before replacing
the old deployment. Delayed jobs previously enqueued in Redis will have no
consumers after rollout; retire those queues separately after operational
review. Historical documentation and changelogs remain as historical records.
