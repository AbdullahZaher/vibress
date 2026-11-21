# M02 — S3 Security Test Hardening

The `mc()` wrapper no longer uses `|| true`. `run()` captures stdout, stderr and exit code separately; `expect_ok` asserts success; `expect_credential_denied` requires a service-side authorization error and explicitly fails on unexpected success, network failure, timeout or unrelated error.

Negative controls prove the harness distinguishes safe from unsafe configurations: identical credentials are accepted; wrong credentials are denied. Both separate-instance (Topology A) and shared-service scoped credentials (Topology B) are distinguished; only Topology A is exercised here, so no claim is made about least-privilege inside one shared service.

Result: 18 PASS lines (including two negative controls) with fail-closed behavior.
