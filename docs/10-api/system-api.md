# System API (Admin)

| Method | Path                                            | Permission                |
| ------ | ----------------------------------------------- | ------------------------- |
| GET    | `/api/admin/v1/settings`                        | `settings.read`           |
| PUT    | `/api/admin/v1/settings/:namespace/:key`        | `settings.manage`         |
| GET    | `/api/admin/v1/settings/public`                 | none (public values only) |
| GET    | `/api/admin/v1/audit`                           | `audit.read`              |
| GET    | `/api/admin/v1/redirects`                       | `redirects.read`          |
| POST   | `/api/admin/v1/redirects`                       | `redirects.manage`        |
| PATCH  | `/api/admin/v1/redirects/:id`                   | `redirects.manage`        |
| DELETE | `/api/admin/v1/redirects/:id`                   | `redirects.manage`        |
| POST   | `/api/admin/v1/imports/validate`                | `imports.manage`          |
| POST   | `/api/admin/v1/imports`                         | `imports.manage`          |
| POST   | `/api/admin/v1/exports`                         | `exports.manage`          |
| GET    | `/api/admin/v1/import-export-jobs`              | `exports.manage`          |
| GET    | `/api/admin/v1/import-export-jobs/:id/artifact` | `exports.manage`          |
| GET    | `/api/admin/v1/system/diagnostics`              | `system.read`             |
| POST   | `/api/admin/v1/system/maintenance`              | `system.manage`           |
| GET    | `/api/admin/v1/system/integrity`                | `system.read`             |

Errors: `UNKNOWN_NAMESPACE`, `UNKNOWN_SETTING`, `VALIDATION_ERROR`,
`INVALID_STATUS_CODE`, `PROTECTED_ROUTE`, `INVALID_DESTINATION`,
`INVALID_FORMAT`, `UNSUPPORTED_VERSION`, `PATH_TRAVERSAL`,
`ARTIFACT_NOT_AVAILABLE`, `ARTIFACT_EXPIRED`.
