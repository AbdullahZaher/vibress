# Historical media-storage inventory (2026-09-19)

A point-in-time diagnostic JSON was formerly committed at `scripts/media-storage-audit.json`. That file contained individual media identifiers and storage keys tied to a particular environment. It has been removed from the current tree to avoid treating environment-specific records as repository configuration.

The diagnostic snapshot was generated on **2026-09-19T11:45:03.992Z** and recorded:

| Metric | Historical snapshot |
| --- | ---: |
| Database media records | 52 |
| Files found under root storage | 1,296 |
| Files found under API storage | 444 |
| Records referencing files found only in root | 19 |
| Records referencing files found only in API storage | 28 |
| Records missing in both storage roots | 5 |
| Unreferenced files in root | 1,277 |
| Unreferenced files in API storage | 416 |
| Conflicting storage keys | 0 |
| Duplicate database keys | 0 |

These counts are **not live measurements**, do **not** establish that an object is safe to delete, and must never be used as a deletion list. Production reconciliation must check the current database, backup status, revision/media references, and authoritative storage provider before proposing any destructive action.

See the original [forensic investigation](../archive/2026-09/VIBRESS_MEDIA_LIBRARY_BROKEN_ASSETS_FORENSIC_ANALYSIS.md) and [remediation report](../archive/2026-09/VIBRESS_MEDIA_STORAGE_REMEDIATION_FINAL_REPORT.md). The original detailed snapshot remains in Git history; do not rewrite published history or redistribute its per-object inventory.
