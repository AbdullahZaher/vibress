// Disabled by default; no production registration or direct pool authority.
import type { ScopedTransaction,TenantUnitOfWorkRunner,VerifiedScope } from "@vibress/tenancy";
import type { DisposableDurableRecoveryAuthority } from "./schema-operator-experimental-durable-authority";
export async function runExperimentalRecoveryUnit<T>(
  authority:DisposableDurableRecoveryAuthority,runner:TenantUnitOfWorkRunner,
  expected:{applicationId:string;installationId:string;databaseName:string;epoch:string;confirm:"DISPOSABLE_ONLY"},
  scope:VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>,
):Promise<T>{
  if(process.env.NODE_ENV!=="test"||scope.applicationId!==expected.applicationId)throw Error("EXPERIMENTAL_ADMISSION_REFUSED");
  return authority.withExperimentalBusinessAdmission(expected,check=>runner.run(scope,async tx=>{
    check();
    const result=await work(tx);
    // Before returning control to the existing runner's transaction settlement.
    // Lease remains held while that runner settles; no claim of atomic remote
    // revocation at COMMIT. Recovery cannot advance until the lease is released.
    check();
    return result;
  }));
}
