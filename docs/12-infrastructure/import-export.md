# Import / Export (Infrastructure)

## Pipeline

```text
upload/validate (API) → job created (import_export_jobs)
  → processor (import: redirects/settings via domains; export: collector)
  → job completed/failed with summary
```

Exports produce a versioned envelope; artifacts expire after 24h and require
`exports.manage` to download. Media is exported as metadata + documented
external storage backup workflow — never a huge synchronous archive.

## Job Recovery

Jobs persist status/progress; failed jobs carry an error summary. Worker
restarts are safe because jobs are read from the durable table.
