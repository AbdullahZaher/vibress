// Isolated recovery-epoch protocol. The pinned public key and live provider are
// operator-host trust roots, NOT request parameters or restored DB state.
// Recovery orchestration must fence all sessions before advancing the epoch.
import { randomUUID, verify, type KeyObject } from "node:crypto";
import type { ExperimentalD1Budget } from "./schema-operator-experimental-deadline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface RecoveryEpochChallenge {
  readonly installationId: string;
  readonly databaseName: string;
  readonly nonce: string;
}
export type RecoveryEpochState = "ACTIVE" | "RECOVERY_PENDING";
export interface RecoveryEpochProof extends RecoveryEpochChallenge {
  readonly epoch: string;
  readonly state: RecoveryEpochState;
  readonly signature: string;
}
export function recoveryEpochMessage(challenge: RecoveryEpochChallenge, epoch: string, state: RecoveryEpochState): Buffer {
  return Buffer.from(JSON.stringify(["VIBRESS-M03-S03-RECOVERY-EPOCH-V1",
    challenge.installationId, challenge.databaseName, challenge.nonce, epoch, state]), "utf8");
}
export class RecoveryEpochAuthority {
  constructor(private readonly pinnedPublicKey: KeyObject,
    private readonly provider: (challenge: RecoveryEpochChallenge, signal: AbortSignal) => Promise<unknown>) {
    if (pinnedPublicKey.type !== "public" || pinnedPublicKey.asymmetricKeyType !== "ed25519") {
      throw Error("invalid recovery authority key");
    }
  }
  async prove(installationId: string, databaseName: string, budget: ExperimentalD1Budget): Promise<string> {
    budget.checkpoint();
    const challenge = { installationId, databaseName, nonce: randomUUID() };
    const signal = AbortSignal.timeout(Math.max(1, Math.floor(budget.remainingMs())));
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = () => reject(Error("recovery proof deadline"));
      signal.addEventListener("abort", rejectDeadline, { once: true });
    });
    let result: unknown;
    try {
      result = await Promise.race([this.provider(challenge, signal), deadline]);
    } finally {
      if (rejectDeadline) signal.removeEventListener("abort", rejectDeadline);
    }
    budget.checkpoint();
    if (!result || typeof result !== "object") throw Error("recovery proof unavailable");
    const proof = result as Partial<RecoveryEpochProof>;
    if (proof.installationId !== installationId || proof.databaseName !== databaseName ||
        proof.nonce !== challenge.nonce || typeof proof.epoch !== "string" || !UUID.test(proof.epoch) ||
        (proof.state !== "ACTIVE" && proof.state !== "RECOVERY_PENDING") ||
        typeof proof.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(proof.signature) ||
        !verify(null, recoveryEpochMessage(challenge, proof.epoch, proof.state), this.pinnedPublicKey,
          Buffer.from(proof.signature, "base64url"))) throw Error("invalid recovery proof");
    // A new epoch alone does not authorize work after journal rollback.
    // External recovery authority must separately attest readiness.
    if (proof.state !== "ACTIVE") throw Error("recovery authorization pending");
    return proof.epoch;
  }
}
