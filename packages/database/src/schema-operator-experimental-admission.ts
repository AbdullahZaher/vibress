// Isolated legacy V1 test-only recovery admission, not V2 physical admission.
// V2 authority state is explicitly refused by the durable admission boundary.
import { TenantUnitOfWork,type ScopedTransaction,type VerifiedScope } from "@vibress/tenancy";
import type { DisposableDurableRecoveryAuthority } from "./schema-operator-experimental-durable-authority";
export async function runExperimentalRecoveryUnit<T>(
  authority:DisposableDurableRecoveryAuthority,runner:TenantUnitOfWork,
  expected:{applicationId:string;installationId:string;databaseName:string;databaseOid:string;runtimeRole:string;epoch:string;confirm:"DISPOSABLE_ONLY"},
  scope:VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>,
):Promise<T>{
  if(process.env.NODE_ENV!=="test"||scope.applicationId!==expected.applicationId)throw Error("EXPERIMENTAL_ADMISSION_REFUSED");
  // Reject before durable admission, including stale inherited ALS contexts.
  TenantUnitOfWork.prototype.assertOutermost.call(runner);
  const target=Object.freeze({...expected});
  const admittedWork=async(tx:ScopedTransaction,check:()=>void)=>{
    const verifyConnection=async()=>{
      const rows=(await tx.query<{version:number;application_id:string;installation_id:string;epoch_id:string;database_name:string;database_oid:string;current_role:string;session_role:string;isolation:string}>(
        "SELECT o.*,current_user AS current_role,session_user AS session_role,current_setting('transaction_isolation') AS isolation FROM public.s03_p06_admission_observation_v1() o"
      )).rows;
      const row=rows[0];
      if(rows.length!==1||!row||row.version!==1||row.application_id!==target.applicationId||
        row.installation_id!==target.installationId||row.epoch_id!==target.epoch||row.database_name!==target.databaseName||
        row.database_oid!==target.databaseOid||row.current_role!==target.runtimeRole||row.session_role!==target.runtimeRole||
        row.isolation!=="read committed")throw Error("EXPERIMENTAL_PERSISTED_ADMISSION_SCOPE_MISMATCH");
    };
    check();await verifyConnection();check();
    const result=await work(tx);
    await verifyConnection();check();
    // INTENT after this check is drain, not retroactive COMMIT revocation.
    return result;
  };
  return authority.withExperimentalBusinessAdmission(target,(check,settle)=>
    TenantUnitOfWork.prototype.runOutermost.call(runner,scope,(tx:ScopedTransaction)=>admittedWork(tx,check),settle) as Promise<T>);
}
