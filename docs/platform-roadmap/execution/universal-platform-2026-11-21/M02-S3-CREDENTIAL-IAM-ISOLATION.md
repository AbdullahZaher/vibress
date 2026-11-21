# M02 — S3 Credential-Level Isolation

Command: `VIBRESS_M02_S3_CONFIRM=1 bash scripts/platform/m02/s3-credential-isolation-drill.sh`
Two independent disposable S3-compatible services with distinct root credentials (`install_a` / `install_b`).

| Assertion | Result |
| --- | --- |
| Correct credentials accepted by own service | PASS |
| A credentials rejected by B (service response) | PASS |
| B credentials rejected by A (service response) | PASS |
| A/B read own objects | PASS |
| Cross-list / cross-read / cross-write / cross-delete | PASS denied by credential rejection |
| No shared root credential | PASS |

8/8 PASS. No credentials appear in logs as secrets; service responses only. This is credential-level isolation, not process-level isolation.
