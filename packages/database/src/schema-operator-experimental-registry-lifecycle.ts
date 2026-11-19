// Persistent registry revision lifecycle for the disposable M03 prototype.
// Callers own the transaction: transitions are CAS updates plus append-only
// history, so an installer COMMIT and a global ACTIVE admission stay distinct.
import type { ClientBase } from "pg";

export const LIFECYCLE_STATES = [
  "PROPOSED", "VALIDATED", "APPROVED", "PROVISIONING", "DB_COMMITTED", "ACTIVE",
  "SUPERSEDED", "REVOKED", "FAILED", "INDETERMINATE", "RECOVERY_PENDING", "REATTESTED",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const NEXT: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  PROPOSED: ["VALIDATED", "REVOKED"],
  VALIDATED: ["APPROVED", "REVOKED"],
  APPROVED: ["PROVISIONING", "REVOKED"],
  PROVISIONING: ["DB_COMMITTED", "FAILED", "INDETERMINATE"],
  DB_COMMITTED: ["ACTIVE", "INDETERMINATE"],
  ACTIVE: ["SUPERSEDED", "REVOKED", "RECOVERY_PENDING"],
  SUPERSEDED: ["REVOKED"],
  REVOKED: [],
  FAILED: [],
  INDETERMINATE: ["RECOVERY_PENDING", "FAILED"],
  RECOVERY_PENDING: ["REATTESTED", "FAILED"],
  REATTESTED: ["ACTIVE"],
});

export interface LifecycleTransitionInput {
  readonly installationId: string;
  readonly revisionDigest: string;
  readonly expectedState: LifecycleState | null;
  readonly nextState: LifecycleState;
  readonly operationId: string;
  readonly approvalId: string;
  readonly epoch: string;
  readonly head?: string;
  readonly sequence?: number;
  readonly actor: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const refusal = (reason: string): never => { throw Error("M03_LIFECYCLE_REFUSED:" + reason); };

export async function recordExperimentalLifecycleTransition(
  db: ClientBase,
  input: LifecycleTransitionInput,
): Promise<{ state: LifecycleState; version: number }> {
  const { installationId, revisionDigest, expectedState, nextState, operationId, approvalId, epoch, actor } = input;
  if (!installationId || installationId.length > 200 || !digest.test(revisionDigest) ||
    !uuid.test(operationId) || !uuid.test(approvalId) || !uuid.test(epoch) || !actor || actor.length > 200) return refusal("INPUT");
  if (expectedState === null) {
    if (nextState !== "PROPOSED") return refusal("ILLEGAL_TRANSITION");
    const inserted = await db.query(
      "INSERT INTO public.platform_schema_revision_states_v1(installation_id,revision_digest,state,state_version,operation_id,approval_id,authority_epoch,authority_head,authority_sequence,actor) VALUES($1,$2,'PROPOSED',1,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
      [installationId, revisionDigest, operationId, approvalId, epoch, input.head ?? null, input.sequence ?? null, actor]);
    if (inserted.rowCount !== 1) return refusal("EXISTS");
    await appendHistory(db, input, null, "PROPOSED", 1);
    return { state: "PROPOSED", version: 1 };
  }
  if (!LIFECYCLE_STATES.includes(expectedState) || !NEXT[expectedState].includes(nextState)) return refusal("ILLEGAL_TRANSITION");
  const current = (await db.query<{ state: LifecycleState; state_version: number; authority_epoch: string }>(
    "SELECT state,state_version,authority_epoch::text AS authority_epoch FROM public.platform_schema_revision_states_v1 WHERE installation_id=$1 AND revision_digest=$2 FOR UPDATE",
    [installationId, revisionDigest])).rows[0];
  if (!current || current.state !== expectedState) return refusal("STALE");
  if (current.authority_epoch !== epoch && expectedState !== "RECOVERY_PENDING") return refusal("EPOCH");
  const version = Number(current.state_version) + 1;
  if (!Number.isInteger(version) || version < 2) return refusal("VERSION");
  const updated = await db.query(
    "UPDATE public.platform_schema_revision_states_v1 SET state=$3,state_version=$4,operation_id=$5,approval_id=$6,authority_epoch=$7,authority_head=$8,authority_sequence=$9,actor=$10,updated_at=clock_timestamp() WHERE installation_id=$1 AND revision_digest=$2 AND state=$11 AND state_version=$12",
    [installationId, revisionDigest, nextState, version, operationId, approvalId, epoch, input.head ?? null, input.sequence ?? null, actor, expectedState, current.state_version]);
  if (updated.rowCount !== 1) return refusal("STALE");
  await appendHistory(db, input, expectedState, nextState, version);
  return { state: nextState, version };
}
async function appendHistory(db: ClientBase, input: LifecycleTransitionInput, from: LifecycleState | null, to: LifecycleState, version: number) {
  await db.query(
    "INSERT INTO public.platform_schema_state_transitions_v1(installation_id,revision_digest,from_state,to_state,state_version,operation_id,approval_id,authority_epoch,authority_head,authority_sequence,actor,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)",
    [input.installationId, input.revisionDigest, from, to, version, input.operationId, input.approvalId, input.epoch, input.head ?? null, input.sequence ?? null, input.actor, JSON.stringify(input.evidence ?? {})]);
}
