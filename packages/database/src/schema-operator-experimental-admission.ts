// Disabled by default; no production registration or direct pool authority.
import type { ScopedTransaction,TenantUnitOfWorkRunner,VerifiedScope } from "@vibress/tenancy";
import type { DisposableDurableRecoveryAuthority } from "./schema-operator-experimental-durable-authority";
export async function runExperimentalRecoveryUnit<T>(
  authority:DisposableDurableRecoveryAuthority,runner:TenantUnitOfWorkRunner,
  expected:{applicationId:string;installationId:string;databaseName:string;databaseOid:string;runtimeRole:string;epoch:string;confirm:"DISPOSABLE_ONLY"},
  scope:VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>,
):Promise<T>{
  if(process.env.NODE_ENV!=="test"||scope.applicationId!==expected.applicationId)throw Error("EXPERIMENTAL_ADMISSION_REFUSED");
  return authority.withExperimentalBusinessAdmission(expected,check=>runner.run(scope,async tx=>{
    const verifyConnection=async()=>{
      const row=(await tx.query<{database_name:string;database_oid:string;current_role:string;session_role:string}>("SELECT current_database() AS database_name,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS database_oid,current_user AS current_role,session_user AS session_role")).rows[0];
      if(!row||row.database_name!==expected.databaseName||row.database_oid!==expected.databaseOid||row.current_role!==expected.runtimeRole||row.session_role!==expected.runtimeRole)throw Error("EXPERIMENTAL_POOL_IDENTITY_MISMATCH");
    };
    check();await verifyConnection();check();
    const result=await work(tx);
    await verifyConnection();
    // Before returning control to the existing runner's transaction settlement.
    // Lease remains held while that runner settles; no claim of atomic remote
    // revocation at COMMIT. Recovery cannot advance until the lease is released.
    check();
    return result;
  }));
}
