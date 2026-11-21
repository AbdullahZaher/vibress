# M02 — R26 / F-012 / R35 Governance Decisions

| Decision | Status | Technical position | Required authority |
| --- | --- | --- | --- |
| R26 function EXECUTE Scope A/B | PENDING / `BLOCKED_GOVERNANCE` | No broad runtime EXECUTE; drill confirms PUBLIC EXECUTE absent and missing grant denial; no permanent policy selected | Owner + AppSec + human DBA |
| F-012 legacy CMS topology | PENDING | Preserve two-publication CMS compatibility; never reinterpret Publication as Application/Tenant | Owner + AppSec |
| R35 views/non-row security | PENDING technical review | Drill shows view owner under FORCE RLS and SECURITY DEFINER search_path; formal DBA review outstanding | Human DBA |

No authorization-sensitive SQL grant was applied. No historical migration was modified. E10 and E12 remain blocked until these decisions are actually issued.
