# M02 — PostgreSQL RLS and Privilege Certification Evidence

Command: `VIBRESS_M02_PG_CONFIRM=1 bash scripts/platform/m02/pg-rls-privilege-drill.sh`
Environment: disposable `postgres:16-alpine`, unique container/port, trap-based teardown, no shared data.

| Assertion | Result |
| --- | --- |
| Own tenant visible under FORCE RLS | PASS 1 |
| Other tenant hidden | PASS 0 |
| Cross-tenant INSERT | PASS denial SQLSTATE 42501 |
| FORCE RLS applies to owner | PASS 0 |
| `relforcerowsecurity` / `relrowsecurity` catalog | PASS t / t |
| TRUNCATE denied to runtime role | PASS 42501 |
| Function EXECUTE denied without grant | PASS 42501 |
| PUBLIC EXECUTE absent | PASS f |
| SECURITY DEFINER / hardened search_path | PASS t / t |
| Runtime role non-superuser/non-BYPASSRLS/no CREATEDB/CREATEROLE | PASS f|f|f|f |
| View owner is forced-RLS owner | PASS m02_owner |
| Session A own row / other scope row | PASS A_VALUE / 0 |

Limitations: this is a disposable logical SQL boundary, not production RLS certification; R26/R35 owner decisions and live OIDC are outside this drill. Migration 0061 was not touched.
