#!/usr/bin/env python3
"""W1-T06 real Redis ACL + MinIO IAM negative tests on NEW disposable Compose only.

No shared-service URL or credentials are accepted. No secret, signed URL, or
object payload is emitted to stdout or to the JSON evidence artifact.
Requires: Docker Compose v2, Python 3.12+, redis and boto3.
"""
from __future__ import annotations

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
        self.env = dict(os.environ, T06_ROOT_USER=self.root_user,
                        T06_ROOT_PASSWORD=self.root_password)
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
            self.redis_matrix(redis_port)
            self.s3_matrix(s3_port)
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
                  "scope": "disposable local Redis and S3 only",
                  "limits": ["Not an application-process identity integration test",
                             "Queue operations use real Redis ACL commands, not BullMQ Worker runtime",
                             "Not a production backup restore or capacity test"]}
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps(report, sort_keys=True))
        return 0 if status == "PASS" else 2


def main():
    if "--self-test" in sys.argv:
        assert len(set(CASES)) == len(CASES)
        assert COMPOSE.exists()
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
