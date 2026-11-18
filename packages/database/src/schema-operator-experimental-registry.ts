// Experimental offline verifier: no new mutation path, serving export or
// normative journal. Actual registry settlement still belongs to P06 operator.
import { createHash,verify,type KeyObject } from "node:crypto";
import type { ClientBase } from "pg";
import { asApplicationId,asInstallationId } from "@vibress/platform-kernel";
import { parseSchemaManifest,renderTrustedAdditiveColumn } from "@vibress/schema-engine";
import { compileExperimentalPhysicalContract } from "@vibress/schema-engine";
import { collectDisposableRecoveryReadiness } from "./platform-schema-migration-operator";
import { inspectSchemaOperatorEffectivePrivileges } from "./platform-schema-effective-privileges";
const deny=():never=>{throw Error("EXPERIMENTAL_REGISTRY_OR_AUTHORITY_DRIFT");};
const sha=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface AcceptedRegistryEvidence {
  readonly version:1;
  readonly applicationId:string;
  readonly installationId:string;
  readonly databaseName:string;
  readonly epoch:string;
  readonly operationId:string;
  readonly submissionId:string;
  readonly approvalId:string;
  readonly planDigest:string;
  readonly previousDigest:string;
  readonly manifestDigest:string;
  readonly dataDigests:Readonly<Record<string,string>>;
}
export function registryAcceptanceMessage(e:AcceptedRegistryEvidence):Buffer{
  return Buffer.from(JSON.stringify(["VIBRESS-M03-REGISTRY-ACCEPTANCE-V1",e.version,e.applicationId,e.installationId,e.databaseName,e.epoch,e.operationId,e.submissionId,e.approvalId,e.planDigest,e.previousDigest,e.manifestDigest,Object.entries(e.dataDigests).sort(([a],[b])=>a.localeCompare(b))]));
}
export async function verifyExperimentalRegistry(db:ClientBase,e:AcceptedRegistryEvidence,signature:string,pinnedApprovalKey:KeyObject){
  if(process.env.NODE_ENV==="production"||e.version!==1||!/^vibress_s03_[a-z0-9_]+$/.test(e.databaseName)||
    ![e.epoch,e.operationId,e.submissionId,e.approvalId].every(x=>uuid.test(x))||![e.planDigest,e.previousDigest,e.manifestDigest].every(x=>sha.test(x))||
    pinnedApprovalKey.type!=="public"||pinnedApprovalKey.asymmetricKeyType!=="ed25519"||!/^[A-Za-z0-9_-]{86}$/.test(signature)||
    !verify(null,registryAcceptanceMessage(e),pinnedApprovalKey,Buffer.from(signature,"base64url")))return deny();
  // Existing collector requires sole fenced root observer, canonical manifest
  // revalidation, actual resource data and current actor enrollment.
  const ready=await collectDisposableRecoveryReadiness(db,{installationId:e.installationId,databaseName:e.databaseName,epoch:e.epoch,manifestDigest:e.manifestDigest,dataDigests:e.dataDigests});
  const rows=(await db.query<{application_id:string;manifest:string;manifest_digest:string;operator_role:string;runtime_role:string;expected_manifest:string;plan:string;previous_digest:string;new_digest:string;recovery_epoch:string;operator_matches:boolean}>(
    "SELECT r.application_id,r.manifest,r.manifest_digest,r.operator_role,r.runtime_role,p.expected_manifest,p.plan,j.previous_digest,j.new_digest,j.catalog_evidence->>'recoveryEpoch' AS recovery_epoch,j.operator_role=r.operator_role AS operator_matches FROM public.platform_schema_registry r JOIN public.s03_p06_completed_operations j ON j.installation_id=r.installation_id JOIN public.platform_schema_plans p ON p.installation_id=j.installation_id AND p.plan_digest=j.canonical_plan_digest WHERE r.installation_id=$1 AND j.operation_id=$2::uuid AND j.submission_id=$3::uuid AND j.approval_id=$4::uuid AND j.canonical_plan_digest=$5",
    [e.installationId,e.operationId,e.submissionId,e.approvalId,e.planDigest])).rows;
  const row=rows[0];
  if(rows.length!==1||!row||row.application_id!==e.applicationId||row.manifest_digest!==e.manifestDigest||row.new_digest!==e.manifestDigest||
    row.previous_digest!==e.previousDigest||row.recovery_epoch!==e.epoch||!row.operator_matches)return deny();
  const scope={applicationId:asApplicationId(e.applicationId),installationId:asInstallationId(e.installationId)};
  const manifest=parseSchemaManifest(JSON.parse(row.manifest));
  const validated=renderTrustedAdditiveColumn(JSON.parse(row.plan),JSON.parse(row.expected_manifest),scope);
  if(validated.plan.digest!==e.planDigest||validated.current.digest!==e.previousDigest||validated.plan.proposedManifest.digest!==manifest.digest||
    manifest.digest!==e.manifestDigest||JSON.stringify(manifest)!==row.manifest)return deny();
  const physical=compileExperimentalPhysicalContract(manifest,scope);
  if(physical.resources.some(x=>x.disposition!=="VERIFY_EXISTING_RESTRICTED"))return deny();
  const effective=await inspectSchemaOperatorEffectivePrivileges(db,row.runtime_role,row.operator_role);
  if(Object.values(effective).some(x=>x!==0))return deny();
  // Compare exact relation/column ACL edges for actual approved resources.
  for(const resource of physical.resources){
    const acl=(await db.query<{identity:string;privilege_type:string;is_grantable:boolean}>(
      "SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS identity,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relname=$1 ORDER BY identity,a.privilege_type",[resource.tableName])).rows;
    const runtime=acl.filter(x=>x.identity===row.runtime_role);
    if(JSON.stringify(runtime.map(x=>x.privilege_type))!==JSON.stringify(["DELETE","INSERT","SELECT","UPDATE"])||runtime.some(x=>x.is_grantable)||
      acl.some(x=>x.identity!==row.runtime_role&&x.identity!==row.operator_role))return deny();
    const extra=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL",[resource.tableName])).rows[0];
    if(extra?.n!==0)return deny();
  }
  // Reobserve after separate inspections. Sole maintenance observer is a
  // required trust assumption; this is not an online concurrency fence.
  const final=await collectDisposableRecoveryReadiness(db,{installationId:e.installationId,databaseName:e.databaseName,epoch:e.epoch,manifestDigest:e.manifestDigest,dataDigests:e.dataDigests});
  if(JSON.stringify(final)!==JSON.stringify(ready))return deny();
  return {version:1 as const,lifecycle:"VERIFIED_COMMITTED" as const,revisionDigest:manifest.digest,previousDigest:e.previousDigest,operationId:e.operationId,physical,
    evidenceDigest:createHash("sha256").update(registryAcceptanceMessage(e)).update(ready.readinessEvidenceDigest).update(physical.digest).digest("hex")};
}
