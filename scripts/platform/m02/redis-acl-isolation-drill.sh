#!/usr/bin/env bash
# M02-E14 — Redis ACL (not merely DB-number) installation isolation drill.
set -Eeuo pipefail
if [ "${VIBRESS_M02_REDIS_CONFIRM:-}" != "1" ]; then
  echo "REFUSED: set VIBRESS_M02_REDIS_CONFIRM=1" >&2; exit 2
fi
C="vibress_m02_redis_$$"
PORT="${VIBRESS_M02_REDIS_PORT:-16381}"
FAILED=0
cleanup() { docker rm -f "${C}" >/dev/null 2>&1 || true; }
trap cleanup EXIT ERR INT TERM
check() { local l="$1" e="$2" a="$3"; if [ "$a" = "$e" ]; then echo "PASS ${l}: ${a}"; else echo "FAIL ${l}: expected ${e}, got ${a}" >&2; FAILED=1; fi }
cli() { docker exec -i "${C}" redis-cli -h 127.0.0.1 "$@"; }
a_cmd() { cli --user install_a --pass a-secret "$@" 2>&1 | grep -v '^Warning:' | grep -v '^$' | tail -1 || true; }
b_cmd() { cli --user install_b --pass b-secret "$@" 2>&1 | grep -v '^Warning:' | grep -v '^$' | tail -1 || true; }
admin_acl() { cli --user drill_admin --pass admin-secret "$@" 2>&1 | grep -v '^Warning:' | grep -v '^$' | tail -1 || true; }
admin_raw() { cli --user drill_admin --pass admin-secret "$@" 2>&1 || true; }

docker run -d --name "${C}" -p "127.0.0.1:${PORT}:6379" redis:7-alpine >/dev/null
for _ in $(seq 1 60); do cli ping >/dev/null 2>&1 && break; sleep 1; done
cli ACL SETUSER drill_admin on '>admin-secret' '~*' +@all >/dev/null
cli ACL SETUSER install_a on '>a-secret' '~install_a:*' +get +set +del +keys +ping >/dev/null
cli ACL SETUSER install_b on '>b-secret' '~install_b:*' +get +set +del +keys +ping >/dev/null
cli ACL SETUSER default off >/dev/null

echo "=== Redis ACL installation isolation ==="
check "A writes own key" "OK" "$(a_cmd SET install_a:secret A_SECRET)"
check "B writes own key" "OK" "$(b_cmd SET install_b:secret B_SECRET)"
check "A reads own key" "A_SECRET" "$(a_cmd GET install_a:secret)"
check "B reads own key" "B_SECRET" "$(b_cmd GET install_b:secret)"
A_CROSS=$(a_cmd GET install_b:secret | tail -1)
B_CROSS=$(b_cmd GET install_a:secret | tail -1)
if printf '%s' "${A_CROSS}" | grep -qi 'NOPERM'; then echo "PASS A cannot read B: NOPERM"; else echo "FAIL A cannot read B: ${A_CROSS}" >&2; FAILED=1; fi
if printf '%s' "${B_CROSS}" | grep -qi 'NOPERM'; then echo "PASS B cannot read A: NOPERM"; else echo "FAIL B cannot read A: ${B_CROSS}" >&2; FAILED=1; fi
A_WRITE=$(a_cmd SET install_b:queue:job EVIL | tail -1)
B_WRITE=$(b_cmd SET install_a:queue:job EVIL | tail -1)
if printf '%s' "${A_WRITE}" | grep -qi 'NOPERM'; then echo "PASS A cannot write B queue: NOPERM"; else echo "FAIL A cannot write B queue: ${A_WRITE}" >&2; FAILED=1; fi
if printf '%s' "${B_WRITE}" | grep -qi 'NOPERM'; then echo "PASS B cannot write A queue: NOPERM"; else echo "FAIL B cannot write A queue: ${B_WRITE}" >&2; FAILED=1; fi
DEFAULT_FLAGS=$(admin_raw ACL GETUSER default | grep -A1 -i '^flags' | tail -1 | tr -d '\r')
if printf '%s' "${DEFAULT_FLAGS}" | grep -qi 'off'; then echo "PASS default user disabled: off"; else echo "FAIL default user disabled: ${DEFAULT_FLAGS}" >&2; FAILED=1; fi
echo "=== Redis ACL drill: $([ "${FAILED}" -eq 0 ] && echo PASS || echo FAIL) ==="
exit "${FAILED}"
