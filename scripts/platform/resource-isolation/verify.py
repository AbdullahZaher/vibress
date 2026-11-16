#!/usr/bin/env python3
"""W1-T06 real Redis ACL + MinIO IAM negative tests on NEW disposable Compose only.

No shared-service URL or credentials are accepted. No secret, signed URL, or
object payload is emitted to stdout or to the JSON evidence artifact.
Requires: Docker Compose v2, Python 3.12+, redis and boto3.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

COMPOSE = Path(__file__).with_name("compose.yml")
REPORT = Path(os.environ.get("W1T06_REPORT", "artifacts/w1t06-resource-isolation.json"))
CASES = [
    "redis_a_own_write", "redis_b_own_write", "redis_a_foreign_read_denied",
    "redis_a_foreign_write_denied", "redis_b_foreign_read_denied",
    "redis_b_foreign_delete_denied", "redis_a_global_scan_denied",
    "redis_queue_a_enqueue", "redis_queue_b_enqueue",
    "redis_a_cross_enqueue_denied", "redis_b_cross_enqueue_denied",
    "redis_worker_a_own_consume", "redis_worker_b_cross_consume_denied",
    "redis_worker_a_own_retry", "redis_worker_a_own_dead_letter",
    "redis_worker_b_cross_dead_letter_denied", "redis_a_rotated_old_denied",
    "redis_a_rotated_new_allowed", "redis_a_revoked_denied",
    "s3_a_own_upload", "s3_b_own_upload", "s3_a_own_download",
    "s3_b_own_list", "s3_a_foreign_list_denied", "s3_a_foreign_get_denied",
    "s3_a_foreign_put_denied", "s3_a_foreign_delete_denied",
    "s3_b_foreign_get_denied", "s3_global_list_scoped_or_denied",
    "s3_backup_a_own_get", "s3_backup_a_foreign_get_denied",
    "s3_backup_a_write_denied", "s3_backup_a_delete_denied",
    "s3_signed_own_get", "s3_signed_foreign_get_denied",
    "s3_signed_expired_denied", "s3_a_revoked_denied",
    "s3_signed_revoked_denied",
    "bullmq_a_enqueue", "bullmq_b_enqueue", "bullmq_a_worker_consumes",
    "bullmq_b_worker_consumes", "bullmq_a_cross_enqueue_denied",
    "bullmq_b_cross_inspect_denied", "bullmq_b_cross_worker_denied",
    "bullmq_a_retry_completes", "bullmq_a_replay_deduplicates",
    "bullmq_a_poison_dead_letter", "bullmq_b_cross_dead_letter_denied",
    "s3_restore_source_read", "s3_restore_target_write",
    "s3_restore_checksum_match", "s3_restore_foreign_read_denied",
    "s3_backup_a_restore_bucket_denied",
    "bullmq_real_webhook_worker_a", "bullmq_real_webhook_worker_b",
    "pg_worker_a_own_read", "pg_worker_b_own_read",
    "pg_worker_a_cross_database_denied", "pg_worker_b_cross_database_denied",
    "pg_worker_a_admin_table_denied", "pg_backup_a_read_only",
    "pg_backup_a_cross_database_denied", "pg_backup_a_write_denied",
    "pg_backup_a_dump", "pg_restore_a_checksum",
    "pg_restore_b_contamination_absent",
]


class CheckError(Exception):
    pass


def spawn(args: list[str], *, env=None, input_text=None, check=True) -> subprocess.CompletedProcess:
    result = subprocess.run(
        args, env=env, input=input_text, text=True,
        capture_output=True, timeout=120, check=False,
    )
    if check and result.returncode:
        # Intentionally do not include stdout/stderr (can contain credentials).
        raise CheckError(f"isolated subprocess failed: executable={Path(args[0]).name}, exit={result.returncode}")
    return result


class Lab:
    def __init__(self):
        self.name = "w1t06" + secrets.token_hex(5)
        self.root_user = "w1t06root"
        self.root_password = secrets.token_hex(24)
        self.pg_password = secrets.token_hex(24)
        self.env = dict(os.environ, T06_ROOT_USER=self.root_user,
                        T06_ROOT_PASSWORD=self.root_password,
                        T06_PG_PASSWORD=self.pg_password)
        self.prefix = "t06:" + self.name + ":"
        self.redis_users: list[str] = []
        self.s3_users: list[str] = []
        self.s3_policies: list[str] = []
        self.buckets: list[str] = []
        self.cases: dict[str, str] = {}
        self.cleanup: list[str] = []
        self.operator = None

    def compose(self, *args: str, check=True, input_text=None):
        return spawn(["docker", "compose", "-p", self.name, "-f", str(COMPOSE),
                      *args], env=self.env, check=check, input_text=input_text)

    def mc(self, *args: str, check=True, input_text=None):
        # Credentials exist only in this throwaway container + short-lived
        # Docker exec environment, never in logs, artifacts or tracked files.
        host = f"MC_HOST_local=http://{self.root_user}:{self.root_password}@127.0.0.1:9000"
        return self.compose("exec", "-T", "-e", host, "minio", "mc",
                            *args, check=check, input_text=input_text)

    def policy_file(self, name, policy):
        filename = f"/tmp/{name}.json"
        self.compose("exec", "-T", "minio", "sh", "-c", f"cat > {filename}",
                     input_text=json.dumps(policy))
        return filename

    def port(self, service: str, port: int):
        result = self.compose("port", service, str(port)).stdout.strip().splitlines()
        if len(result) != 1 or not result[0].startswith("127.0.0.1:"):
            raise CheckError("service is not bound exclusively to loopback")
        return int(result[0].rsplit(":", 1)[1])

    def allow(self, label, operation):
        if label in self.cases:
            raise CheckError("duplicate test ID")
        operation()
        self.cases[label] = "ALLOW_OBSERVED"

    def deny_redis(self, label, operation, *, authentication=False):
        import redis
        try:
            operation()
        except redis.exceptions.AuthenticationError:
            if authentication:
                self.cases[label] = "AUTH_DENIED_OBSERVED"
                return
            raise CheckError(label + " produced AUTH error, not ACL denial")
        except redis.exceptions.NoPermissionError:
            if not authentication:
                self.cases[label] = "NOPERM_OBSERVED"
                return
            raise CheckError(label + " was not an authentication denial")
        except redis.exceptions.ResponseError as exc:
            if not authentication and "NOPERM" in str(exc).upper():
                self.cases[label] = "NOPERM_OBSERVED"
                return
            raise CheckError(label + " returned unexpected Redis error")
        raise CheckError(label + " unexpectedly allowed an operation")

    def deny_s3(self, label, operation):
        from botocore.exceptions import ClientError
        try:
            operation()
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"AccessDenied", "AllAccessDisabled", "InvalidAccessKeyId", "403"}:
                self.cases[label] = "S3_403_OBSERVED"
                return
            raise CheckError(label + " returned unexpected S3 error: " + code)
        raise CheckError(label + " unexpectedly allowed an S3 operation")

    def deny_url(self, label, url):
        try:
            with urllib.request.urlopen(url, timeout=8):
                pass
        except urllib.error.HTTPError as exc:
            if exc.code == 403:
                self.cases[label] = "HTTP_403_OBSERVED"
                return
            raise CheckError(label + " returned HTTP " + str(exc.code))
        raise CheckError(label + " unexpectedly served a signed URL")

    def s3(self, user, secret, port):
        import boto3
        from botocore.config import Config
        return boto3.client(
            "s3", endpoint_url=f"http://127.0.0.1:{port}",
            aws_access_key_id=user, aws_secret_access_key=secret,
            region_name="us-east-1",
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                          retries={"max_attempts": 1, "mode": "standard"}),
        )

    def s3_policy(self, bucket, readonly=False):
        actions = ["s3:GetObject"]
        if not readonly:
            actions += ["s3:PutObject", "s3:DeleteObject"]
        return {"Version": "2012-10-17", "Statement": [
            {"Effect": "Allow", "Action": ["s3:ListBucket"],
             "Resource": [f"arn:aws:s3:::{bucket}"]},
            {"Effect": "Allow", "Action": actions,
             "Resource": [f"arn:aws:s3:::{bucket}/*"]},
        ]}

    def provision(self, redis_port, s3_port):
        import redis
        # Brand-new Redis instance only: remove anonymous default user.
        bootstrap = redis.Redis(host="127.0.0.1", port=redis_port, socket_timeout=5)
        self.op_pass = secrets.token_hex(24)
        bootstrap.execute_command("ACL", "SETUSER", "w1t06op", "reset", "on",
                                  ">" + self.op_pass, "~*", "&*", "+@all")
        bootstrap.execute_command("ACL", "SETUSER", "default", "reset", "on", "nopass", "+ping")
        bootstrap.close()
        self.operator = redis.Redis(host="127.0.0.1", port=redis_port,
                                    username="w1t06op", password=self.op_pass,
                                    decode_responses=True, socket_timeout=5)
        self.operator.ping()
        # Redis 7.4.11 fixes published ACL key-selection bypasses affecting
        # SORT and XREAD; older images cannot certify ACL isolation.
        version = str(self.operator.info("server").get("redis_version", ""))
        try:
            parsed = tuple(int(part) for part in version.split(".")[:3])
        except ValueError:
            raise CheckError("Redis version could not be verified") from None
        if len(parsed) != 3 or parsed[0] != 7 or parsed < (7, 4, 11):
            raise CheckError("Redis server lacks required 7.4.11 ACL fixes")
        self.service_versions = {"redis": version,
                                 "minio_container_image": "pgsty/silo:RELEASE.2026-09-16"}
        self.redis_passwords = {}
        for suffix in ("a", "b", "wa", "wb"):
            user = "w1t06_" + suffix
            password = secrets.token_hex(24)
            pattern = "~" + self.prefix + ("a:" if suffix in ("a", "wa") else "b:") + "*"
            self.operator.execute_command(
                "ACL", "SETUSER", user, "reset", "on", ">" + password,
                pattern, "resetchannels", "+@all", "-@dangerous",
                "-keys", "-scan", "-randomkey", "-dbsize", "-monitor",
                "-flushall", "-flushdb", "-acl", "-config",
            )
            self.redis_passwords[suffix] = (user, password)
            self.redis_users.append(user)

        self.s3_passwords = {}
        for suffix in ("a", "b", "backup_a"):
            user = "t06" + self.name + suffix
            password = secrets.token_hex(24)
            bucket = "t06-" + self.name + ("-b" if suffix == "b" else "-a")
            policy = "p" + user
            if bucket not in self.buckets:
                self.mc("mb", "local/" + bucket)
                self.buckets.append(bucket)
            path = self.policy_file(policy, self.s3_policy(bucket, readonly=suffix == "backup_a"))
            self.mc("admin", "policy", "create", "local", policy, path)
            self.s3_policies.append(policy)
            self.mc("admin", "user", "add", "local", user, password)
            self.s3_users.append(user)
            self.mc("admin", "policy", "attach", "local", policy, "--user", user)
            self.s3_passwords[suffix] = (user, password)
        self.bucket_a = "t06-" + self.name + "-a"
        self.bucket_b = "t06-" + self.name + "-b"

    def redis_matrix(self, port):
        import redis
        def client(suffix, override=None):
            name, password = self.redis_passwords[suffix]
            return redis.Redis(host="127.0.0.1", port=port,
                               username=name, password=password if override is None else override,
                               decode_responses=True, socket_timeout=5,
                               socket_connect_timeout=5)
        a, b, wa, wb = (client(s) for s in ("a", "b", "wa", "wb"))
        ak, bk = self.prefix + "a:cache:value", self.prefix + "b:cache:value"
        aq, bq = self.prefix + "a:bull:jobs:wait", self.prefix + "b:bull:jobs:wait"
        ad, bd = self.prefix + "a:bull:jobs:failed", self.prefix + "b:bull:jobs:failed"
        self.allow("redis_a_own_write", lambda: a.set(ak, "A"))
        self.allow("redis_b_own_write", lambda: b.set(bk, "B"))
        self.deny_redis("redis_a_foreign_read_denied", lambda: a.get(bk))
        self.deny_redis("redis_a_foreign_write_denied", lambda: a.set(bk, "overwrite"))
        self.deny_redis("redis_b_foreign_read_denied", lambda: b.get(ak))
        self.deny_redis("redis_b_foreign_delete_denied", lambda: b.delete(ak))
        self.deny_redis("redis_a_global_scan_denied", lambda: a.scan(0))
        self.allow("redis_queue_a_enqueue", lambda: a.lpush(aq, "a-job"))
        self.allow("redis_queue_b_enqueue", lambda: b.lpush(bq, "b-job"))
        self.deny_redis("redis_a_cross_enqueue_denied", lambda: a.lpush(bq, "intruder"))
        self.deny_redis("redis_b_cross_enqueue_denied", lambda: b.lpush(aq, "intruder"))
        def consume_a():
            if wa.rpop(aq) != "a-job":
                raise CheckError("worker A did not consume its own job")
        self.allow("redis_worker_a_own_consume", consume_a)
        self.deny_redis("redis_worker_b_cross_consume_denied", lambda: wb.rpop(aq))
        self.allow("redis_worker_a_own_retry",
                   lambda: wa.lpush(self.prefix + "a:bull:jobs:retry", "retry-a"))
        self.allow("redis_worker_a_own_dead_letter", lambda: wa.lpush(ad, "failed-a"))
        self.deny_redis("redis_worker_b_cross_dead_letter_denied",
                        lambda: wb.lpush(ad, "inject"))
        name, old = self.redis_passwords["a"]
        rotated = secrets.token_hex(24)
        self.operator.execute_command("ACL", "SETUSER", name, "resetpass", ">" + rotated)
        self.operator.execute_command("CLIENT", "KILL", "USER", name)
        self.deny_redis("redis_a_rotated_old_denied",
                        lambda: client("a").ping(), authentication=True)
        self.allow("redis_a_rotated_new_allowed", lambda: client("a", rotated).get(ak))
        self.operator.execute_command("ACL", "SETUSER", name, "off")
        self.operator.execute_command("CLIENT", "KILL", "USER", name)
        self.deny_redis("redis_a_revoked_denied",
                        lambda: client("a", rotated).ping(), authentication=True)
        for c in (a, b, wa, wb):
            c.close()

    def node_case(self, port, mode, principal, installation, job_id, kind="normal"):
        from urllib.parse import quote
        user, password = self.redis_passwords[principal]
        prefix = self.prefix + installation + ":bull"
        env = dict(self.env,
                   NODE_ENV="test",
                   REDIS_URL=f"redis://{quote(user, safe='')}:{quote(password, safe='')}@127.0.0.1:{port}",
                   VIBRESS_REQUIRE_INSTALLATION_ISOLATION="1",
                   VIBRESS_QUEUE_PREFIX=prefix,
                   VIBRESS_INSTALLATION_ID=installation,
                   T06_JOB_ID=job_id,
                   T06_JOB_KIND=kind)
        script = str(Path(__file__).with_name("worker-boundary.ts"))
        result = spawn(["pnpm", "exec", "tsx", script, mode], env=env, check=False)
        # The child process emits only a sanitized status. Errors (potentially
        # including connection URIs) are deliberately discarded, never printed.
        if result.returncode:
            raise CheckError("BullMQ isolated child failed: " + mode)
        records = [line for line in result.stdout.splitlines()
                   if line.startswith('{"status":')]
        if len(records) != 1:
            raise CheckError("BullMQ child did not report exactly one status")
        payload = json.loads(records[0])
        if not isinstance(payload, dict) or "status" not in payload:
            raise CheckError("BullMQ child report malformed")
        return payload

    def bullmq_matrix(self, port):
        def outcome(label, mode, principal, installation, job_id, expected, kind="normal"):
            record = self.node_case(port, mode, principal, installation, job_id, kind)
            if record.get("status") != expected:
                raise CheckError(label + " returned unexpected worker outcome")
            self.cases[label] = expected + "_OBSERVED"
            return record

        outcome("bullmq_a_enqueue", "producer", "a", "a",
                "normal-a", "ENQUEUED")
        outcome("bullmq_b_enqueue", "producer", "b", "b",
                "normal-b", "ENQUEUED")
        outcome("bullmq_a_cross_enqueue_denied", "producer-denied", "a", "b",
                "foreign-b", "ENQUEUE_NOPERM")
        outcome("bullmq_b_cross_inspect_denied", "inspect-denied", "b", "a",
                "normal-a", "INSPECT_NOPERM")
        # A foreign Worker must receive an actual Redis script ACL error.
        # The waiting job must remain, then be consumed by the valid Worker.
        outcome("bullmq_b_cross_worker_denied", "worker-denied", "wb", "a",
                "normal-a", "WORKER_NOPERM")
        outcome("bullmq_a_worker_consumes", "worker", "wa", "a",
                "normal-a", "CONSUMED")
        outcome("bullmq_b_worker_consumes", "worker", "wb", "b",
                "normal-b", "CONSUMED")
        self.node_case(port, "producer", "a", "a", "domain-a")
        outcome("bullmq_real_webhook_worker_a", "domain-worker", "wa", "a",
                "domain-a", "DOMAIN_CONSUMED")
        self.node_case(port, "producer", "b", "b", "domain-b")
        outcome("bullmq_real_webhook_worker_b", "domain-worker", "wb", "b",
                "domain-b", "DOMAIN_CONSUMED")
        outcome("bullmq_a_retry_completes", "producer", "a", "a",
                "retry-a", "ENQUEUED", "retry")
        result = self.node_case(port, "worker", "wa", "a", "retry-a", "retry")
        if result.get("status") != "CONSUMED" or result.get("attempts") != 2:
            raise CheckError("retry job did not complete in two attempts")
        self.cases["bullmq_a_retry_completes"] = "RETRY_2_ATTEMPTS_OBSERVED"

        # Replaying a BullMQ jobId must not create an independently
        # deliverable second job. This is a queue-level, not domain-side proof.
        outcome("bullmq_a_replay_deduplicates", "producer", "a", "a",
                "normal-a", "ENQUEUED")
        state = self.node_case(port, "inspect", "a", "a", "normal-a")
        if state.get("state") != "completed" or state.get("attemptsMade") != 1:
            raise CheckError("duplicate job replayed or mutated terminal state")
        self.cases["bullmq_a_replay_deduplicates"] = "DEDUPLICATED_OBSERVED"

        self.node_case(port, "producer", "a", "a", "poison-a", "poison")
        result = self.node_case(port, "worker", "wa", "a", "poison-a", "poison")
        state = self.node_case(port, "inspect", "a", "a", "poison-a")
        if result.get("status") != "POISON_BLOCKED" or state.get("state") != "failed" or \
           result.get("sideEffects") != 0:
            raise CheckError("poison job was not rejected before side effect")
        self.cases["bullmq_a_poison_dead_letter"] = "FAILED_QUEUE_ISOLATED_OBSERVED"
        outcome("bullmq_b_cross_dead_letter_denied", "inspect-denied", "b", "a",
                "poison-a", "INSPECT_NOPERM")

    def s3_matrix(self, port):
        root = self.s3(self.root_user, self.root_password, port)
        a = self.s3(*self.s3_passwords["a"], port)
        b = self.s3(*self.s3_passwords["b"], port)
        backup = self.s3(*self.s3_passwords["backup_a"], port)
        ba, bb = self.bucket_a, self.bucket_b
        root.put_object(Bucket=bb, Key="private.txt", Body=b"foreign")
        self.allow("s3_a_own_upload",
                   lambda: a.put_object(Bucket=ba, Key="own.txt", Body=b"own"))
        self.allow("s3_b_own_upload",
                   lambda: b.put_object(Bucket=bb, Key="own.txt", Body=b"b-own"))
        def own():
            data = a.get_object(Bucket=ba, Key="own.txt")["Body"].read()
            if data != b"own":
                raise CheckError("own S3 object integrity mismatch")
        self.allow("s3_a_own_download", own)
        self.allow("s3_b_own_list", lambda: b.list_objects_v2(Bucket=bb))
        self.deny_s3("s3_a_foreign_list_denied", lambda: a.list_objects_v2(Bucket=bb))
        self.deny_s3("s3_a_foreign_get_denied",
                     lambda: a.get_object(Bucket=bb, Key="private.txt"))
        self.deny_s3("s3_a_foreign_put_denied",
                     lambda: a.put_object(Bucket=bb, Key="inject.txt", Body=b"deny"))
        self.deny_s3("s3_a_foreign_delete_denied",
                     lambda: a.delete_object(Bucket=bb, Key="private.txt"))
        self.deny_s3("s3_b_foreign_get_denied",
                     lambda: b.get_object(Bucket=ba, Key="own.txt"))
        # MinIO may return a filtered ListBuckets response (HTTP 200) rather
        # than HTTP 403. Both are acceptable ONLY if bucket B is not exposed.
        # The explicit cross-bucket ListObjects denial was measured above.
        def global_list_scope():
            from botocore.exceptions import ClientError
            try:
                response = a.list_buckets()
            except ClientError as exc:
                if str(exc.response.get("Error", {}).get("Code", "")) in {
                    "AccessDenied", "AllAccessDisabled", "InvalidAccessKeyId", "403"
                }:
                    self.cases["s3_global_list_scoped_or_denied"] = "S3_403_OBSERVED"
                    return
                raise CheckError("unexpected global bucket listing error")
            listed = {item["Name"] for item in response.get("Buckets", [])}
            if bb in listed or not listed.issubset({ba}):
                raise CheckError("global bucket listing leaked a foreign bucket")
            self.cases["s3_global_list_scoped_or_denied"] = "S3_SCOPED_LIST_OBSERVED"
        global_list_scope()
        self.allow("s3_backup_a_own_get",
                   lambda: backup.get_object(Bucket=ba, Key="own.txt")["Body"].read())
        self.deny_s3("s3_backup_a_foreign_get_denied",
                     lambda: backup.get_object(Bucket=bb, Key="private.txt"))
        self.deny_s3("s3_backup_a_write_denied",
                     lambda: backup.put_object(Bucket=ba, Key="x", Body=b"x"))
        self.deny_s3("s3_backup_a_delete_denied",
                     lambda: backup.delete_object(Bucket=ba, Key="own.txt"))

        def signed_get(url):
            with urllib.request.urlopen(url, timeout=8) as response:
                if response.read() != b"own":
                    raise CheckError("signed URL returned wrong object")
        own_signed = a.generate_presigned_url(
            "get_object", Params={"Bucket": ba, "Key": "own.txt"}, ExpiresIn=60)
        self.allow("s3_signed_own_get", lambda: signed_get(own_signed))
        foreign_signed = a.generate_presigned_url(
            "get_object", Params={"Bucket": bb, "Key": "private.txt"}, ExpiresIn=60)
        self.deny_url("s3_signed_foreign_get_denied", foreign_signed)
        expiring = a.generate_presigned_url(
            "get_object", Params={"Bucket": ba, "Key": "own.txt"}, ExpiresIn=1)
        time.sleep(3)
        self.deny_url("s3_signed_expired_denied", expiring)
        revoked_signed = a.generate_presigned_url(
            "get_object", Params={"Bucket": ba, "Key": "own.txt"}, ExpiresIn=60)
        self.mc("admin", "user", "disable", "local", self.s3_passwords["a"][0])
        self.deny_s3("s3_a_revoked_denied", lambda: a.get_object(Bucket=ba, Key="own.txt"))
        self.deny_url("s3_signed_revoked_denied", revoked_signed)

    def recovery_matrix(self, port):
        # Object-storage-only recovery into a NEW isolated bucket. PostgreSQL
        # recovery is explicitly not represented by these tests.
        root = self.s3(self.root_user, self.root_password, port)
        backup = self.s3(*self.s3_passwords["backup_a"], port)
        source_bucket = self.bucket_a
        bucket = "t06-" + self.name + "-restore"
        user = "t06" + self.name + "restore"
        policy = "p" + user
        password = secrets.token_hex(24)
        self.mc("mb", "local/" + bucket)
        self.buckets.append(bucket)
        path = self.policy_file(policy, self.s3_policy(bucket))
        self.mc("admin", "policy", "create", "local", policy, path)
        self.s3_policies.append(policy)
        self.mc("admin", "user", "add", "local", user, password)
        self.s3_users.append(user)
        self.mc("admin", "policy", "attach", "local", policy, "--user", user)
        restore = self.s3(user, password, port)

        # The snapshot content is read by the read-only backup identity, not
        # by a privileged root used to provision IAM.
        started = time.monotonic()
        snapshot_at = time.time()
        body = backup.get_object(Bucket=source_bucket, Key="own.txt")["Body"].read()
        if body != b"own":
            raise CheckError("source backup content unexpected")
        digest = hashlib.sha256(body).hexdigest()
        self.cases["s3_restore_source_read"] = "BACKUP_READ_OBSERVED"
        restore.put_object(Bucket=bucket, Key="own.txt", Body=body)
        self.cases["s3_restore_target_write"] = "ISOLATED_RESTORE_WRITE_OBSERVED"

        recovered = restore.get_object(Bucket=bucket, Key="own.txt")["Body"].read()
        objects = restore.list_objects_v2(Bucket=bucket).get("Contents", [])
        if hashlib.sha256(recovered).hexdigest() != digest or \
           sorted(x["Key"] for x in objects) != ["own.txt"]:
            raise CheckError("object restore checksum mismatch or foreign data present")
        self.cases["s3_restore_checksum_match"] = "CHECKSUM_MATCH_OBSERVED"
        self.deny_s3("s3_restore_foreign_read_denied",
                     lambda: restore.get_object(Bucket=self.bucket_b, Key="private.txt"))
        self.deny_s3("s3_backup_a_restore_bucket_denied",
                     lambda: backup.get_object(Bucket=bucket, Key="own.txt"))
        self.recovery_metrics = {
            "object_restore_seconds": round(time.monotonic() - started, 3),
            "snapshot_age_seconds_at_end": round(time.time() - snapshot_at, 3),
            "postgres_restore": "NOT_EXECUTED",
            "owner_approved_rpo_target": None,
            "owner_approved_rto_target": None,
            "full_recovery_certified": False,
        }

    def pg_admin(self, database: str, sql: str):
        return self.compose("exec", "-T", "postgres", "psql", "-X", "-At",
                            "-U", "t06admin", "-d", database,
                            "-v", "ON_ERROR_STOP=1", check=True,
                            input_text=sql).stdout.strip()

    def pg_as(self, role: str, database: str, sql: str, *, dump=False):
        # No password or secret is passed on process command-line arguments.
        # Temporary pgpass file is in the self-owned disposable container.
        if dump:
            return self.compose("exec", "-T", "-e", "PGPASSFILE=/tmp/t06.pgpass",
                                "postgres", "pg_dump", "-h", "127.0.0.1",
                                "-U", role, "-d", database,
                                "--data-only", "--column-inserts",
                                "--table=public.worker_state", check=False)
        return self.compose("exec", "-T", "-e", "PGPASSFILE=/tmp/t06.pgpass",
                            "postgres", "psql", "-h", "127.0.0.1",
                            "-U", role, "-d", database, "-X", "-At",
                            "-v", "ON_ERROR_STOP=1", "-c", sql, check=False)

    def postgres_matrix(self):
        # The disposable database superuser is strictly a setup operator.
        # The application/worker and backup roles are non-superusers.
        identities = {
            "t06_worker_a": secrets.token_hex(24),
            "t06_worker_b": secrets.token_hex(24),
            "t06_backup_a": secrets.token_hex(24),
            "t06_owner_a": secrets.token_hex(24),
            "t06_owner_b": secrets.token_hex(24),
        }
        statements = []
        for role, password in identities.items():
            statements.append(
                "CREATE ROLE " + role +
                " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS "
                "PASSWORD '" + password + "';")
        self.pg_admin("postgres", "\n".join(statements))
        for suffix in ("a", "b"):
            self.pg_admin("postgres",
                "CREATE DATABASE t06_db_" + suffix + " OWNER t06_owner_" + suffix + ";")
            self.pg_admin("postgres",
                "REVOKE ALL ON DATABASE t06_db_" + suffix + " FROM PUBLIC;"
                "GRANT CONNECT ON DATABASE t06_db_" + suffix + " TO t06_worker_" + suffix + ";")
            self.pg_admin("t06_db_" + suffix,
                "CREATE TABLE public.worker_state(payload text PRIMARY KEY);"
                "CREATE TABLE public.platform_admin_marker(secret text);"
                "INSERT INTO public.worker_state VALUES ('" + suffix.upper() + "_MARKER');"
                "REVOKE ALL ON public.worker_state FROM PUBLIC;"
                "REVOKE ALL ON public.platform_admin_marker FROM PUBLIC;"
                "GRANT SELECT ON public.worker_state TO t06_worker_" + suffix + ";")
        self.pg_admin("postgres",
            "GRANT CONNECT ON DATABASE t06_db_a TO t06_backup_a;")
        self.pg_admin("t06_db_a",
            "GRANT SELECT ON public.worker_state TO t06_backup_a;")
        entries = []
        for role, password in identities.items():
            entries.append(f"127.0.0.1:5432:*:{role}:{password}")
        self.compose("exec", "-T", "postgres", "sh", "-c",
                     "umask 077; cat > /tmp/t06.pgpass; chmod 600 /tmp/t06.pgpass",
                     input_text="\n".join(entries) + "\n")

        for suffix in ("a", "b"):
            role = "t06_worker_" + suffix
            own = self.pg_as(role, "t06_db_" + suffix,
                             "SELECT session_user || ':' || payload FROM public.worker_state")
            if own.returncode != 0 or own.stdout.strip() != role + ":" + suffix.upper() + "_MARKER":
                raise CheckError("Worker did not authenticate using its own DB role")
            self.cases["pg_worker_" + suffix + "_own_read"] = "AUTHENTICATED_READ_OBSERVED"
            foreign = "b" if suffix == "a" else "a"
            denied = self.pg_as(role, "t06_db_" + foreign, "SELECT 1")
            if denied.returncode == 0 or "permission denied for database" not in denied.stderr.lower():
                raise CheckError("Foreign worker DB connection unexpectedly allowed")
            self.cases["pg_worker_" + suffix + "_cross_database_denied"] = "DB_CONNECT_DENIED_OBSERVED"

        denied = self.pg_as("t06_worker_a", "t06_db_a",
                            "SELECT * FROM public.platform_admin_marker")
        if denied.returncode == 0 or "permission denied" not in denied.stderr.lower():
            raise CheckError("Worker A read privileged owner table")
        self.cases["pg_worker_a_admin_table_denied"] = "DB_SELECT_DENIED_OBSERVED"

        backup = self.pg_as("t06_backup_a", "t06_db_a",
                            "SELECT payload FROM public.worker_state")
        if backup.returncode or backup.stdout.strip() != "A_MARKER":
            raise CheckError("Backup principal cannot read authorized table")
        self.cases["pg_backup_a_read_only"] = "BACKUP_READ_OBSERVED"
        denied = self.pg_as("t06_backup_a", "t06_db_b", "SELECT 1")
        if denied.returncode == 0 or "permission denied for database" not in denied.stderr.lower():
            raise CheckError("Backup A accessed DB B")
        self.cases["pg_backup_a_cross_database_denied"] = "DB_CONNECT_DENIED_OBSERVED"
        denied = self.pg_as("t06_backup_a", "t06_db_a",
                            "UPDATE public.worker_state SET payload='BAD'")
        if denied.returncode == 0 or "permission denied" not in denied.stderr.lower():
            raise CheckError("Backup A modified its own source data")
        self.cases["pg_backup_a_write_denied"] = "DB_WRITE_DENIED_OBSERVED"

        restore_started = time.monotonic()
        snapshot_at = time.time()
        dump = self.pg_as("t06_backup_a", "t06_db_a", "", dump=True)
        if dump.returncode or "A_MARKER" not in dump.stdout or "B_MARKER" in dump.stdout:
            raise CheckError("Backup-role dump failed or crossed installation boundary")
        self.cases["pg_backup_a_dump"] = "BACKUP_ROLE_PG_DUMP_OBSERVED"
        self.pg_admin("postgres", "CREATE DATABASE t06_db_a_recovered OWNER t06_owner_a;"
                      "REVOKE ALL ON DATABASE t06_db_a_recovered FROM PUBLIC;"
                      "GRANT CONNECT ON DATABASE t06_db_a_recovered TO t06_worker_a;")
        self.pg_admin("t06_db_a_recovered", "CREATE TABLE public.worker_state(payload text PRIMARY KEY);")
        self.pg_admin("t06_db_a_recovered", dump.stdout)
        original = self.pg_admin("t06_db_a",
                                  "SELECT payload FROM public.worker_state ORDER BY payload;")
        recovered = self.pg_admin("t06_db_a_recovered",
                                  "SELECT payload FROM public.worker_state ORDER BY payload;")
        if original != recovered or recovered != "A_MARKER":
            raise CheckError("PostgreSQL restored state differs from installation A backup")
        self.cases["pg_restore_a_checksum"] = "PG_RESTORED_ROWS_MATCH_OBSERVED"
        absent = self.pg_admin("t06_db_a_recovered",
                               "SELECT COUNT(*) FROM public.worker_state WHERE payload LIKE 'B_%';")
        if absent != "0":
            raise CheckError("Installation B row contaminated A recovery DB")
        self.cases["pg_restore_b_contamination_absent"] = "NO_FOREIGN_ROWS_OBSERVED"
        self.pg_recovery_metrics = {
            "table_level_pg_restore_seconds": round(time.monotonic() - restore_started, 3),
            "snapshot_age_seconds_at_end": round(time.time() - snapshot_at, 3),
            "recovery_type": "disposable single-table SQL data-only replay",
            "full_vibress_backup_restore": "NOT_EXECUTED",
            "owner_approved_rpo_target": None,
            "owner_approved_rto_target": None,
            "production_rpo_rto_certified": False,
        }

    def teardown(self):
        # This stack was created under a random dedicated project name; never
        # run cleanup against host-wide or shared infrastructure.
        if self.operator:
            try:
                for key in self.operator.scan_iter(match=self.prefix + "*"):
                    self.operator.delete(key)
                for user in self.redis_users:
                    self.operator.execute_command("ACL", "DELUSER", user)
                if any(self.operator.execute_command("ACL", "GETUSER", x)
                       for x in self.redis_users):
                    raise CheckError("Redis test identity remained")
                if self.operator.scan(0, match=self.prefix + "*", count=100)[1]:
                    raise CheckError("Redis test keys remained")
                self.cleanup.append("redis_users_and_keys_removed")
            except Exception:
                self.cleanup.append("redis_cleanup_failed")
            finally:
                self.operator.close()
        for user in reversed(self.s3_users):
            self.mc("admin", "user", "rm", "local", user, check=False)
        for policy in reversed(self.s3_policies):
            self.mc("admin", "policy", "rm", "local", policy, check=False)
        for bucket in reversed(self.buckets):
            self.mc("rb", "--force", "local/" + bucket, check=False)
        if self.s3_users:
            clean = all(self.mc("admin", "user", "info", "local", user,
                                check=False).returncode != 0 for user in self.s3_users)
            clean &= all(self.mc("admin", "policy", "info", "local", p,
                                 check=False).returncode != 0 for p in self.s3_policies)
            clean &= all(self.mc("ls", "local/" + b,
                                 check=False).returncode != 0 for b in self.buckets)
            self.cleanup.append("s3_users_policies_buckets_removed" if clean
                                else "s3_cleanup_failed")
        result = self.compose("down", "--volumes", "--remove-orphans", check=False)
        remaining = self.compose("ps", "-q", check=False)
        if result.returncode == 0 and not remaining.stdout.strip():
            self.cleanup.append("compose_removed")
        else:
            self.cleanup.append("compose_cleanup_failed")

    def run(self):
        if os.environ.get("W1T06_DISPOSABLE") != "I_ACKNOWLEDGE_DISPOSABLE_ONLY":
            raise CheckError("explicit disposable-only acknowledgement required")
        if not COMPOSE.is_file():
            raise CheckError("dedicated Compose specification missing")
        started = False
        fatal = None
        try:
            started = True
            self.compose("up", "-d", "--wait")
            redis_port, s3_port = self.port("redis", 6379), self.port("minio", 9000)
            self.provision(redis_port, s3_port)
            self.postgres_matrix()
            self.bullmq_matrix(redis_port)
            self.redis_matrix(redis_port)
            self.s3_matrix(s3_port)
            self.recovery_matrix(s3_port)
        except Exception as exc:
            # No exception body from external SDK/CLI ever enters the report.
            fatal = type(exc).__name__
        finally:
            if started:
                try:
                    self.teardown()
                except Exception:
                    self.cleanup.append("teardown_exception")
        expected = set(CASES)
        passed = set(self.cases)
        cleanup_ok = all(x in self.cleanup for x in
                         ["redis_users_and_keys_removed",
                          "s3_users_policies_buckets_removed", "compose_removed"])
        status = "PASS" if fatal is None and passed == expected and cleanup_ok else "FAIL"
        report = {"schema": "w1t06-resource-isolation/v1",
                  "status": status, "run": self.name,
                  "cases": self.cases,
                  "unexecuted": sorted(expected - passed),
                  "cleanup": self.cleanup, "error_class": fatal,
                  "service_versions": getattr(self, "service_versions", {}),
                  "recovery_metrics": getattr(self, "recovery_metrics", {}),
                  "pg_recovery_metrics": getattr(self, "pg_recovery_metrics", {}),
                  "scope": "disposable Redis/S3 and real BullMQ processes only",
                  "limits": ["Real WebhookDeliveryWorker with mocked outbound side effect; not a complete Webhook/DB integration",
                             "Domain-level installation admission and DB privileges still unverified",
                             "Disposable PG table-level and S3 object recovery are not full platform restore or approved RPO/RTO"]}
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps(report, sort_keys=True))
        return 0 if status == "PASS" else 2


def main():
    if "--self-test" in sys.argv:
        assert len(set(CASES)) == len(CASES)
        assert COMPOSE.exists()
        assert Path(__file__).with_name("worker-boundary.ts").exists()
        assert "secrets" not in str(CASES).lower()
        print("SELF_TEST_PASS (static contracts only; no deny tests executed)")
        return 0
    return Lab().run()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("W1T06_BLOCKED: " + type(exc).__name__, file=sys.stderr)
        sys.exit(3)
