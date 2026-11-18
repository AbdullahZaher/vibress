import { createHash } from "node:crypto";
import { parseSchemaManifest, planSchemaChanges, type SchemaManifest } from "./planning";
import { renderTrustedAdditiveColumn } from "./operator-contract";
import type { SchemaCompilationScope } from "./schema";

/** No namespace reservation, DDL authority or tenant provisioning. The only
 * supported physical topology here is the existing M03-S03 application-owned
 * ordinary table, with mapped scalar columns and no keys/defaults/triggers. */
export function compileExperimentalPhysicalContract(input:unknown,scope:SchemaCompilationScope){
  const manifest=parseSchemaManifest(input);
  if(manifest.applicationId!==scope.applicationId||manifest.installationId!==scope.installationId)throw Error("PHYSICAL_SCOPE_MISMATCH");
  const names=new Set<string>();
  const resources=manifest.resources.map(resource=>{
    if(!/^vr_[a-z][a-z0-9_]*_[0-9a-f]{12}$/.test(resource.tableName)||Buffer.byteLength(resource.tableName)>63||names.has(resource.tableName))throw Error("PHYSICAL_IDENTIFIER_COLLISION");
    names.add(resource.tableName);
    const supported=resource.ownership==="application"&&resource.fields.every(f=>f.mappingStatus==="MAPPED"&&f.postgresType!==null&&!Object.hasOwn(f,"default"));
    const columns=resource.fields.map(f=>{
      if(!/^[a-z][a-z0-9_]{0,62}$/.test(f.id))throw Error("PHYSICAL_IDENTIFIER_INVALID");
      return {name:f.id,type:f.postgresType,nullable:!f.required,mapping:f.mappingStatus,defaultPolicy:Object.hasOwn(f,"default")?"REVIEW_REQUIRED":"ABSENT"};
    });
    return {resourceId:resource.id,installationId:manifest.installationId,namespace:"public" as const,tableName:resource.tableName,kind:"ordinary-permanent" as const,
      ownership:resource.ownership,columns,disposition:supported?"VERIFY_EXISTING_RESTRICTED":"REVIEW_REQUIRED",
      namespaceReservation:"UNAUTHORIZED",createTable:"REVIEW_REQUIRED",primaryKeyPolicy:supported?"NONE_IN_RESTRICTED_TOPOLOGY":"REVIEW_REQUIRED",
      uniqueKeyPolicy:supported?"NONE_IN_RESTRICTED_TOPOLOGY":"REVIEW_REQUIRED",foreignKeyPolicy:"UNSUPPORTED",
      indexPolicy:supported?"NONE_IN_RESTRICTED_TOPOLOGY":"REVIEW_REQUIRED",rls:resource.ownership==="tenant"?"MANDATORY_UNIMPLEMENTED":"DISABLED_RESTRICTED_APPLICATION",
      acl:resource.ownership==="tenant"?"SCOPED_POLICY_REQUIRED":"EXACT_OPERATOR_OWNER_RUNTIME_DML"};
  });
  const payload={version:1 as const,postgresVersion:16 as const,applicationId:manifest.applicationId,installationId:manifest.installationId,manifestDigest:manifest.digest,resources};
  return {...payload,digest:createHash("sha256").update(JSON.stringify(payload)).digest("hex")};
}

/** Pure preparation; only existing authorized ADD_FIELD renderer may produce
 * SQL, and even that has no authority to execute outside existing operator. */
export function prepareExperimentalPhysicalTransition(current:SchemaManifest|null,proposed:unknown,scope:SchemaCompilationScope){
  const next=parseSchemaManifest(proposed);
  const accepted=current===null?null:parseSchemaManifest(current);
  const physical=compileExperimentalPhysicalContract(next,scope);
  const plan=planSchemaChanges(accepted,next.canonicalIr,{scope,expectedCurrentDigest:accepted?.digest??null});
  try{
    const validated=renderTrustedAdditiveColumn(plan,accepted,scope);
    return {plan,physical,disposition:"EXISTING_OPERATOR_AUTHORIZATION_REQUIRED" as const,ddl:validated.ddl};
  }catch{
    return {plan,physical,disposition:"NO_EXECUTABLE_DDL" as const,ddl:null};
  }
}
