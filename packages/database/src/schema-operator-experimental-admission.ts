// Legacy V1 test-only observation contract. No V2 or serving registration.
import { TenantUnitOfWork,type ScopedTransaction,type VerifiedScope } from "@vibress/tenancy";
import type { DisposableDurableRecoveryAuthority } from "./schema-operator-experimental-durable-authority";
export interface ExperimentalAdmissionTarget {
  readonly applicationId:string;
  readonly installationId:string;
  readonly databaseName:string;
  readonly databaseOid:string;
  readonly runtimeRole:string;
  readonly epoch:string;
  readonly confirm:"DISPOSABLE_ONLY";
}
export async function verifyExperimentalAdmissionConnection(tx:ScopedTransaction,target:ExperimentalAdmissionTarget):Promise<void>{
  const rows=(await tx.query<{version:number;application_id:string;installation_id:string;epoch_id:string;database_name:string;database_oid:string;current_role:string;session_role:string;isolation:string}>(
    "SELECT o.*,current_user AS current_role,session_user AS session_role,current_setting('transaction_isolation') AS isolation FROM public.s03_p06_admission_observation_v1() o"
  )).rows;
  const row=rows[0];
  if(rows.length!==1||!row||row.version!==1||row.application_id!==target.applicationId||
    row.installation_id!==target.installationId||row.epoch_id!==target.epoch||row.database_name!==target.databaseName||
    row.database_oid!==target.databaseOid||row.current_role!==target.runtimeRole||row.session_role!==target.runtimeRole||
    row.isolation!=="read committed")throw Error("EXPERIMENTAL_PERSISTED_ADMISSION_SCOPE_MISMATCH");
}
export function runExperimentalRecoveryUnit<T>(
  authority:DisposableDurableRecoveryAuthority,runner:TenantUnitOfWork,expected:ExperimentalAdmissionTarget,
  scope:VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>,
):Promise<T>{
  return authority.withExperimentalBusinessAdmission(expected,runner,scope,work);
}
