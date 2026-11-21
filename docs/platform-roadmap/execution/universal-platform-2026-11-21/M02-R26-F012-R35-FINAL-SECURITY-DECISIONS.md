# M02 — R26 / F-012 / R35 Final Security Decisions

| Decision | Status | Evidence / position | Required authority |
| --- | --- | --- | --- |
| R26 function EXECUTE | PENDING (`BLOCKED_GOVERNANCE`) | PG16 drill verifies PUBLIC EXECUTE absent and missing-grant denial; no permanent Scope A/B selected | Owner + AppSec + human DBA |
| F-012 CMS topology | PENDING | Two-publication compatibility preserved; `pub_default` never an app/tenant identity | Owner + AppSec |
| R35 views/non-row | PENDING | FORCE RLS, view owner, SECURITY DEFINER search_path and TRUNCATE denial evidenced in disposable drill | Human DBA |

No authorization-sensitive grant or topology change was applied. E10/E12 remain blocked.
