#!/usr/bin/env bash
# PLUG-OPS-01..06: read-only acceptance gate on a VERIFIED isolated clone.
# Requires independent API×2 / Worker×2 signed admission receipts.
# NEVER performs restore, DB writes, schema changes, replay, or key rotation.
set -euo pipefail

fail() {
  printf '%s\n' 'PLUGIN_M1A_ACCEPTANCE_BLOCKED: verify isolated-clone state and each diagnostic result' >&2
  exit 1
}

if [[ ${VIBRESS_PLUGIN_RECOVERY_MAINTENANCE:-} != "1" ||
      ${VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE:-} != "1" ||
      ${VIBRESS_PLUGIN_DRILL_ISOLATED_CLONE_ACK:-} != "1" ]]; then
  fail
fi
if [[ ${VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY:-} != "strict" ||
      ${VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE:-} != "1" ||
      -z ${VIBRESS_TRUSTED_PLUGIN_LOCKFILE:-} ||
      -z ${VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256:-} ||
      -z ${VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256:-} ||
      -z ${VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID:-} ||
      -z ${VIBRESS_PLUGIN_SECRET_KEYS_JSON:-} ]]; then
  fail
fi
if [[ $# -lt 4 || $# -gt 128 ]]; then
  fail
fi
for input in "$@"; do
  # Only absolute, independently captured local evidence files; never URLs,
  # flags, shell expansions or paths derived from plugin-owned content.
  if [[ ! "$input" =~ ^(api|worker):[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}=/ ]]; then
    fail
  fi
done

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd -- "$ROOT_DIR"

# Each subprocess is a bounded, existing, read-only operator check.
# Do not bypass errors. The active keyring is required for the v1/v2
# compatibility scan, but no ciphertext is migrated by this procedure.
pnpm exec tsx scripts/plugins/check-restore.ts || fail
pnpm exec tsx scripts/plugins/check-queue-recovery.ts || fail
pnpm exec tsx scripts/plugins/rotate-secrets.ts || fail
pnpm exec tsx scripts/plugins/check-replica-receipts.ts "$@" || fail
VIBRESS_PLUGIN_RECEIPT_DIAGNOSTICS=1 pnpm exec tsx scripts/plugins/check-receipt-health.ts || fail

printf '%s\n' 'PLUGIN_M1A_READ_ONLY_CHECKS_PASSED: production DR, RPO/RTO, fleet quiescence and replay safety remain separately unverified'
