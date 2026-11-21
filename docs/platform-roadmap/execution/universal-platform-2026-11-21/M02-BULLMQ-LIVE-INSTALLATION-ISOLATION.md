# M02 — BullMQ Live Installation Isolation

Status: drill implemented in `scripts/platform/m02/bullmq-installation-drill.{sh,mts}` using two disposable Redis instances with distinct credentials and real BullMQ Queue/Worker execution. The drill covers own-job processing, modified HMAC payload, wrong installation, revoked principal, replay, delayed job, durable nonce persistence and cross-installation credential denial.

Result: **9/9 PASS** — own job processed, modified HMAC rejected, wrong installation rejected, revoked principal rejected, replay rejected, delayed job binding preserved, side effects applied exactly once per nonce, durable replay state, cross-installation credential denial. Raw log: `M02-BULLMQ-DRILL-LOG.txt`. No exactly-once claim is made beyond the tested persisted-nonce boundary; distributed transactional guarantees remain out of scope.
