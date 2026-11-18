#!/usr/bin/env bash
set -euo pipefail
[[ "$GITHUB_ACTIONS" == true && "$M03_PHYSICAL_CONTAINER" == vibress-m03-physical-ci && "$M03_PHYSICAL_COMPONENT" == 1 ]]
name="$M03_PHYSICAL_CONTAINER"
image=postgres@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e
case "$1" in
start)
 docker pull "$image"
 docker image inspect --format '{{json .RepoDigests}}' "$image"
 docker run -d --name "$name" --label vibress.m03.physical=ci --network host --entrypoint sleep "$image" infinity >/dev/null
 docker exec -u postgres -i "$name" bash -s <<'PG'
set -euo pipefail
umask 077
mkdir /tmp/m03-physical /tmp/m03-physical/archive
printf '%s\n' vibress > /tmp/m03-physical/pw
initdb -D /tmp/m03-physical/primary --username=vibress --pwfile=/tmp/m03-physical/pw --auth-local=trust --auth-host=scram-sha-256 >/dev/null
rm /tmp/m03-physical/pw
cat >> /tmp/m03-physical/primary/postgresql.conf <<'CONF'
listen_addresses = '127.0.0.1'
port = 5433
unix_socket_directories = '/tmp/m03-physical'
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /tmp/m03-physical/archive/%f && cp %p /tmp/m03-physical/archive/%f'
fsync = on
full_page_writes = on
synchronous_commit = on
track_commit_timestamp = on
CONF
pg_ctl -D /tmp/m03-physical/primary -l /tmp/m03-physical/primary.log -w start
createdb -p 5433 -h /tmp/m03-physical -U vibress vibress
[[ "$(psql -p 5433 -h /tmp/m03-physical -U vibress -d vibress -Atqc 'SHOW server_version_num')" == 160016 ]]
PG
 ;;
backup)
 docker exec -u postgres "$name" bash -euc '
 r=/tmp/m03-physical
 start=$(cut -d " " -f1 /proc/uptime)
 pg_basebackup -p 5433 -h "$r" -U vibress -D "$r/backup" -X stream -c fast --manifest-checksums=SHA256
 pg_verifybackup "$r/backup"
 end=$(cut -d " " -f1 /proc/uptime)
 echo "BACKUP_KIB=$(du -sk "$r/backup" | cut -f1)"; awk -v s="$start" -v e="$end" "BEGIN{print \"BACKUP_SECONDS=\" e-s}"
 '
 ;;
archive)
 [[ "$2" =~ ^[0-9A-F]{24}$ ]]
 docker exec -u postgres "$name" bash -euc '
 start=$(cut -d " " -f1 /proc/uptime)
 for ((i=0;i<120;i++)); do [[ -s /tmp/m03-physical/archive/$1 ]] && break; sleep 1; done
 [[ -s /tmp/m03-physical/archive/$1 ]]
 end=$(cut -d " " -f1 /proc/uptime); awk -v s="$start" -v e="$end" "BEGIN{print \"ARCHIVE_WAIT_SECONDS=\" e-s}"
 ' -- "$2"
 ;;
restore)
 docker exec -u postgres "$name" bash -euc '
 r=/tmp/m03-physical
 pg_ctl -D "$r/primary" -m fast -w stop
 ! pg_ctl -D "$r/primary" status
 start=$(cut -d " " -f1 /proc/uptime)
 cp -a "$r/backup" "$r/restored"
 cat >> "$r/restored/postgresql.auto.conf" <<CONF
archive_mode = off
restore_command = '\''cp /tmp/m03-physical/archive/%f %p'\''
recovery_target_name = '\''vibress_component_target'\''
recovery_target_action = promote
CONF
 touch "$r/restored/recovery.signal"
 pg_ctl -D "$r/restored" -l "$r/restored.log" -w start || { tail -80 "$r/restored.log"; exit 1; }
 for ((i=0;i<120;i++)); do
   [[ "$(psql -p 5433 -h "$r" -U vibress -d vibress -Atqc "SELECT pg_is_in_recovery()" 2>/dev/null || true)" == f ]] && break
   sleep 1
 done
 [[ "$(psql -p 5433 -h "$r" -U vibress -d vibress -Atqc "SELECT pg_is_in_recovery()")" == f ]]
 end=$(cut -d " " -f1 /proc/uptime); awk -v s="$start" -v e="$end" "BEGIN{print \"RESTORE_DATABASE_AVAILABLE_SECONDS=\" e-s}"
 pg_controldata "$r/restored" | grep -E "Database system identifier|TimeLineID"
 grep -E "recovery stopping|redo done|selected new timeline|archive recovery complete" "$r/restored.log"
 '
 ;;
cleanup)
 if [[ "$(docker inspect -f '{{index .Config.Labels "vibress.m03.physical"}}' "$name" 2>/dev/null || true)" == ci ]]; then docker rm -f "$name" >/dev/null; fi
 ! docker inspect "$name" >/dev/null 2>&1
 ;;
*) exit 2 ;;
esac
