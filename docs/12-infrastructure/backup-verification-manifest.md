# Vibress Backup Manifest — Batch 15 Final Release Verification

# Created: 2026-08-09 (local workstation, macOS 15.7.3 / M4 Pro 12-core / 24GB)

## Components captured

1. PostgreSQL full dump (custom format): postgres.dump (1.51 MB, 59 tables)
2. Object storage: storage/ (mc mirror of bucket vibress-test-bucket, media assets) + minio-volume-snapshot/ (raw volume copy)
3. Encryption key: SECURED SEPARATELY — not inside this artifact; live copy at /tmp/vibress-backup-verify/ (session temp) (see below)
4. Deployment configuration: see compose.dev.yml, .env (names only), nginx.conf
5. Plugin code/config: none bundled at release gate (plugins are user-installed)

## Encryption key handling

- VIBRESS_ENCRYPTION_KEY is NOT copied into this backup artifact.
- It is preserved at its original secure location (.env, gitignored) with
  the same value as at capture time, so restore uses the SAME key.
- Key never printed/committed; verified by prefix + integrity of encrypted
  round-trips after restore.

## Source environment fingerprint

- DB: postgresql://vibress@127.0.0.1:5433/vibress (vibress-postgres-1, PG 16.14)
- Redis: 127.0.0.1:6380, MinIO 127.0.0.1:9000, Mailpit 1025/8025, meilisearch 7890
- Runtimes: api 7780, worker 7782, web 7778, admin 7779, portal 7781, gateway 7777

## Counts captured

- posts=1312, pages=131, members=1662 (baseline; may change if tests reseed), comments=2114, search_documents=1403
