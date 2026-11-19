// Authenticated continuation of durable interrupted operations. Inspection is
// a read-only classification. Settlement delegates to the existing signed,
// operation-specific evidence authorities; this module never manufactures an
// outcome, re-admits an operation, or performs an administrative bypass.
import type {ClientBase} from "pg";
import type {DisposableDurableRecoveryAuthority} from "./schema-operator-experimental-durable-authority";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refuse=(reason:string):never=>{throw Error("M03_CONTINUATION_REFUSED:"+reason);};

export type ExperimentalOperationKind="PROVISIONING"|"BUSINESS";
export type ExperimentalOperationOutcome="ADMITTED"|"UNCERTAIN"|"COMMITTED"|"ROLLED_BACK";
export interface ExperimentalOperationProvenance{
  installationId:string;databaseName:string;epoch:string;revision:string;
}
export interface ExperimentalOperationView{
  kind:ExperimentalOperationKind;operationId:string;outcome:ExperimentalOperationOutcome;
  provenance:ExperimentalOperationProvenance;
}
export interface ExperimentalContinuationRequest{kind:ExperimentalOperationKind;operationId:string}
export interface ExperimentalContinuationResult{
  status:"SETTLED"|"ALREADY_SETTLED";kind:ExperimentalOperationKind;operationId:string;
  outcome:"COMMITTED"|"ROLLED_BACK";provenance:ExperimentalOperationProvenance;
}

export function inspectExperimentalOperations(authority:DisposableDurableRecoveryAuthority):{pending:boolean;operations:ExperimentalOperationView[]}{
  const s=authority.authenticatedSnapshot();
  const operations:ExperimentalOperationView[]=[
    ...(s.provisioningOperations??[]).map(p=>({kind:"PROVISIONING" as const,operationId:p.operationId,
      outcome:p.outcome as ExperimentalOperationOutcome,
      provenance:{installationId:p.installationId,databaseName:p.databaseName,epoch:p.epoch,revision:p.manifestDigest}})),
    ...(s.provisionedBusinessOperations??[]).map(p=>({kind:"BUSINESS" as const,operationId:p.operationId,
      outcome:p.outcome as ExperimentalOperationOutcome,
      provenance:{installationId:p.installationId,databaseName:p.databaseName,epoch:p.epoch,revision:p.revision}})),
  ];
  return {pending:s.pending,operations};
}

// The caller supplies the exact observation and its administration signature.
// The authority re-observes the live database around the signed head, so a
// mismatched, replayed, or unsigned continuation is refused rather than
// repaired. Terminal operations are idempotent read-only replays.
export async function continueExperimentalOperation(db:ClientBase,authority:DisposableDurableRecoveryAuthority,
  request:ExperimentalContinuationRequest,evidence:string,signature:string):Promise<ExperimentalContinuationResult>{
  if(!request||(request.kind!=="PROVISIONING"&&request.kind!=="BUSINESS")||typeof request.operationId!=="string"||!uuid.test(request.operationId))return refuse("REQUEST");
  const locate=()=>inspectExperimentalOperations(authority).operations.find(o=>o.kind===request.kind&&o.operationId===request.operationId);
  const operation=locate();
  if(!operation)return refuse("UNKNOWN_OPERATION");
  if(operation.outcome==="COMMITTED"||operation.outcome==="ROLLED_BACK")
    return {status:"ALREADY_SETTLED",kind:operation.kind,operationId:operation.operationId,outcome:operation.outcome,provenance:operation.provenance};
  if(operation.outcome!=="UNCERTAIN")return refuse("NOT_INTERRUPTED");
  if(request.kind==="PROVISIONING")await authority.resolveExperimentalProvisioningCommit(db,evidence,signature);
  else{
    // Business settlement is bound to the single durable lease; a record that
    // is not the leased interruption cannot be settled through this path.
    const lease=authority.authenticatedSnapshot().businessLease;
    if(lease!==request.operationId)return refuse("NOT_INTERRUPTED");
    await authority.resolveExperimentalProvisionedBusiness(db,evidence,signature);
  }
  const settled=locate();
  if(!settled||(settled.outcome!=="COMMITTED"&&settled.outcome!=="ROLLED_BACK"))return refuse("SETTLEMENT_NOT_OBSERVED");
  return {status:"SETTLED",kind:settled.kind,operationId:settled.operationId,outcome:settled.outcome,provenance:settled.provenance};
}
