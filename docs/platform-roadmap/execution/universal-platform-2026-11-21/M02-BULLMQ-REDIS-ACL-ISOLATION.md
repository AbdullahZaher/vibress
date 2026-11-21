# M02 — BullMQ/Redis ACL Isolation

Existing Redis ACL drill (9/9 PASS) preserved: distinct ACL users, prefix-scoped key patterns, default user disabled, cross-installation read/write NOPERM both directions.

Added contract-level worker boundary: `packages/tenancy/src/worker-envelope.ts` with installation/application binding, HMAC signing, nonce replay protection, staleness window and principal revocation (6/6 tests).

Limitation: no real BullMQ producer/consumer integration or actual queue acknowledgment replay test was executed. This remains a bounded, nonproduction evidence gap, not a claimed pass.
