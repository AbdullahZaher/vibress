import { createHash } from "node:crypto";
import { createSchemaManifest, parseSchemaManifest, planSchemaChanges, type SchemaManifest } from "./planning";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import { renderTrustedAdditiveColumn } from "./operator-contract";
import { compileResourceSchema, type SchemaCompilationScope } from "./schema";

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
    const validated=renderTrustedAdditiveColumn(JSON.parse(JSON.stringify(plan)),accepted===null?null:JSON.parse(JSON.stringify(accepted)),scope);
    return {plan,physical,disposition:"EXISTING_OPERATOR_AUTHORIZATION_REQUIRED" as const,ddl:validated.ddl};
  }catch{
    return {plan,physical,disposition:"NO_EXECUTABLE_DDL" as const,ddl:null};
  }
}


// Versioned opt-in provisioning profile. This extends (does not reinterpret)
// Manifest V1 and the frozen restricted ADD_FIELD operator.
export const PROVISIONING_PROFILE="DEDICATED_PG16_CORE_V1" as const;
const hashPhysical=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function provisioningIdentifier(value:string):string{
  if(typeof value!=="string"||! /^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error("PROVISIONING_IDENTIFIER");
  return '"'+value+'"';
}
export function provisioningNamespace(scope:SchemaCompilationScope):string{
  return "v3_core_"+hashPhysical([PROVISIONING_PROFILE,scope.applicationId,scope.installationId]).slice(0,24);
}
// Observation semantics of the original compiler-generated PG16 V1 SQL.
// Not part of historical signed V1 manifest/physical digest serialization.
// Portable names describe default collation identity, not locale equivalence.
export const PROVISIONING_CATALOG_VERIFICATION_PROFILE="PG16_CORE_CATALOG_V1" as const;
export function provisioningColumnCollationV1(type:string):string|null{
  if(type==="text")return "pg_catalog.default";
  if(["uuid","boolean","double precision","timestamp with time zone"].includes(type))return null;
  throw Error("PROVISIONING_CATALOG_TYPE_UNSUPPORTED");
}
export function provisioningIndexKeyV1(type:string){
  if(type==="text")return {opclass:"pg_catalog.text_ops",family:"pg_catalog.text_ops",collation:"pg_catalog.default"};
  if(type==="uuid")return {opclass:"pg_catalog.uuid_ops",family:"pg_catalog.uuid_ops",collation:"-"};
  throw Error("PROVISIONING_CATALOG_INDEX_UNSUPPORTED");
}
export interface ProvisionedColumn {name:string;type:string;required:boolean;enumValues?:readonly string[];target?:string}
export interface ProvisionedResource {
  id:string;table:string;ownership:"application"|"tenant";columns:readonly ProvisionedColumn[];
  key:readonly string[];unique:readonly string[];relations:readonly {column:string;table:string;columns:readonly string[];targetColumns:readonly string[]}[];
}
export function compileProvisioningContract(input:unknown,scope:SchemaCompilationScope){
  const manifest=parseSchemaManifest(input);
  if(manifest.applicationId!==scope.applicationId||manifest.installationId!==scope.installationId||manifest.resources.length>16)throw Error("PROVISIONING_SCOPE");
  const namespace=provisioningNamespace({applicationId:manifest.applicationId,installationId:manifest.installationId});
  const resources:ProvisionedResource[]=manifest.resources.map(resource=>{
    provisioningIdentifier(resource.tableName);
    if(resource.fields.length>32)throw Error("PROVISIONING_FIELD_BOUND");
    const tenant=resource.ownership==="tenant",key=tenant?["tenant_id","id"]:["id"];
    const columns:ProvisionedColumn[]=[...(tenant?[{name:"tenant_id",type:"text",required:true}]:[]),{name:"id",type:"uuid",required:true}];
    const relations:ProvisionedResource["relations"][number][]=[];
    for(const field of resource.fields){
      provisioningIdentifier(field.id);
      if(Object.hasOwn(field,"default"))throw Error("PROVISIONING_DEFAULT_REVIEW_REQUIRED");
      if(field.logicalType==="relation"){
        const target=manifest.resources.find(x=>x.id===field.targetResource);
        if(!target||target.ownership!==resource.ownership)throw Error("PROVISIONING_RELATION_SCOPE");
        columns.push({name:field.id,type:"uuid",required:field.required,target:target.tableName});
        relations.push({column:field.id,table:target.tableName,columns:tenant?["tenant_id",field.id]:[field.id],targetColumns:key});
      }else if(field.logicalType==="enum"){
        if(!field.values?.length)throw Error("PROVISIONING_ENUM");
        columns.push({name:field.id,type:"text",required:field.required,enumValues:[...field.values]});
      }else{
        if(!field.postgresType||!["text","double precision","boolean","timestamp with time zone"].includes(field.postgresType)||field.mappingStatus!=="MAPPED")throw Error("PROVISIONING_TYPE_UNSUPPORTED");
        columns.push({name:field.id,type:field.postgresType,required:field.required});
      }
    }
    // Explicit narrow profile: a declared required text 'code' is a scoped
    // business key; unrelated fields are never silently promoted to keys.
    const code=columns.find(c=>c.name==="code");
    if(code&&(code.type!=="text"||!code.required||code.enumValues))throw Error("PROVISIONING_CODE_KEY");
    return {id:resource.id,table:resource.tableName,ownership:resource.ownership,columns,key,unique:code?(tenant?["tenant_id","code"]:["code"]):[],relations};
  });
  const seen=new Set<string>(),active=new Set<string>();
  const walk=(name:string)=>{
    if(active.has(name))throw Error("PROVISIONING_CYCLIC_RELATION");
    if(seen.has(name))return;
    active.add(name);
    for(const edge of resources.find(x=>x.table===name)!.relations)walk(edge.table);
    active.delete(name);seen.add(name);
  };
  for(const resource of resources)walk(resource.table);
  const body={version:1 as const,profile:PROVISIONING_PROFILE,applicationId:manifest.applicationId,installationId:manifest.installationId,namespace,manifestDigest:manifest.digest,resources};
  return {...body,digest:hashPhysical(body)};
}
export type ProvisioningContract=ReturnType<typeof compileProvisioningContract>;
export const provisioningConstraintName=(table:string,kind:string,column="")=>"v3_"+kind+"_"+hashPhysical([table,kind,column]).slice(0,20);
const qi=provisioningIdentifier;
const namesSql=(names:readonly string[])=>names.map(qi).join(", ");
const tbl=(namespace:string,table:string)=>qi(namespace)+"."+qi(table);
export function provisioningConstraints(resource:ProvisionedResource,namespace:string){
  const constraints=[{name:provisioningConstraintName(resource.table,"pk"),kind:"p",columns:[...resource.key],target:null as string|null,targetColumns:[] as string[],expression:"PRIMARY KEY ("+resource.key.join(", ")+")"}];
  if(resource.unique.length)constraints.push({name:provisioningConstraintName(resource.table,"uq"),kind:"u",columns:[...resource.unique],target:null,targetColumns:[],expression:"UNIQUE ("+resource.unique.join(", ")+")"});
  for(const relation of resource.relations)constraints.push({name:provisioningConstraintName(resource.table,"fk",relation.column),kind:"f",columns:[...relation.columns],target:relation.table,targetColumns:[...relation.targetColumns],expression:"FOREIGN KEY ("+namesSql(relation.columns)+") REFERENCES "+tbl(namespace,relation.table)+" ("+namesSql(relation.targetColumns)+") ON UPDATE RESTRICT ON DELETE RESTRICT"});
  return constraints;
}
export function provisioningTenantExpression(applicationId:string){
  if(!/^[a-z][a-z0-9_-]{1,62}$/.test(applicationId)||applicationId==="pub_default")throw Error("PROVISIONING_APPLICATION_ID");
  return "(tenant_id = current_setting('vibress.tenant_id'::text, true)) AND (current_setting('vibress.application_id'::text, true) = '"+applicationId+"'::text) AND (tenant_id ~ '^[a-z][a-z0-9_-]{1,62}$'::text) AND (tenant_id <> 'pub_default'::text)";
}
function columnSql(c:ProvisionedColumn){
  return qi(c.name)+" "+c.type+(c.required?" NOT NULL":"");
}
export function compileProvisioningTransition(current:unknown|null,proposed:unknown,scope:SchemaCompilationScope){
  const next=parseSchemaManifest(proposed),before=current===null?null:parseSchemaManifest(current);
  const physical=compileProvisioningContract(next,scope),previous=before?compileProvisioningContract(before,scope):null;
  const statements:string[]=[];
  const all=physical.resources;
  if(!previous){
    for(const resource of all){
      const q=tbl(physical.namespace,resource.table);
      const constraints=provisioningConstraints(resource,physical.namespace).filter(c=>c.kind!=="f");
      statements.push("CREATE TABLE "+q+" ("+[...resource.columns.map(columnSql),...constraints.map(c=>"CONSTRAINT "+qi(c.name)+" "+c.expression)].join(", ")+")");
      if(resource.ownership==="tenant"){
        statements.push("ALTER TABLE "+q+" ENABLE ROW LEVEL SECURITY","ALTER TABLE "+q+" FORCE ROW LEVEL SECURITY",
          "CREATE POLICY v3_tenant_boundary ON "+q+" AS RESTRICTIVE FOR ALL TO PUBLIC USING ("+provisioningTenantExpression(physical.applicationId)+") WITH CHECK ("+provisioningTenantExpression(physical.applicationId)+")",
          "CREATE POLICY v3_tenant_access ON "+q+" AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)");
      }
      for(const c of resource.columns){
        if(c.enumValues)statements.push("ALTER TABLE "+q+" ADD CONSTRAINT "+qi(provisioningConstraintName(resource.table,"enum",c.name))+" CHECK ("+qi(c.name)+" = ANY (ARRAY["+c.enumValues.map(v=>"'"+v+"'::text").join(", ")+"]))");
      }
    }
    for(const resource of all)for(const relation of resource.relations){
      const c=provisioningConstraints(resource,physical.namespace).find(x=>x.name===provisioningConstraintName(resource.table,"fk",relation.column))!;
      const q=tbl(physical.namespace,resource.table);
      statements.push("ALTER TABLE "+q+" ADD CONSTRAINT "+qi(c.name)+" "+c.expression,
        "CREATE INDEX "+qi(provisioningConstraintName(resource.table,"ix",relation.column))+" ON "+q+" ("+namesSql(relation.columns)+")");
    }
  }else{
    // Existing resources/ownership/relations/keys cannot be removed or changed.
    // This is a separate profile, not permission for the legacy operator.
    if(previous.resources.length!==all.length)throw Error("PROVISIONING_EVOLUTION_REVIEW_REQUIRED");
    for(const old of previous.resources){
      const resource=all.find(x=>x.id===old.id);
      if(!resource||old.table!==resource.table||old.ownership!==resource.ownership||
        JSON.stringify(old.key)!==JSON.stringify(resource.key)||JSON.stringify(old.unique)!==JSON.stringify(resource.unique)||
        JSON.stringify(old.relations)!==JSON.stringify(resource.relations))throw Error("PROVISIONING_DESTRUCTIVE_REFUSED");
      for(const col of old.columns)if(JSON.stringify(col)!==JSON.stringify(resource.columns.find(c=>c.name===col.name)))throw Error("PROVISIONING_DESTRUCTIVE_REFUSED");
      for(const col of resource.columns.filter(c=>!old.columns.some(x=>x.name===c.name))){
        if(col.required||col.enumValues||col.target)throw Error("PROVISIONING_EVOLUTION_REVIEW_REQUIRED");
        statements.push("ALTER TABLE "+tbl(physical.namespace,resource.table)+" ADD COLUMN "+columnSql(col));
      }
    }
  }
  if(statements.length===0)throw Error("PROVISIONING_NO_CHANGES");
  const body={version:1 as const,profile:PROVISIONING_PROFILE,parent:before?.digest??null,manifest:next,physical,statements};
  return {...body,digest:hashPhysical(body)};
}

// Portable content identity is intentionally a different checksum domain.
// The original manifests, approval messages, plan and physical digests are
// unchanged and remain installation-bound. No neutral-scope SQL or approval
// is returned; this evidence cannot authorize any installation.
export function compilePortableProvisioningIdentity(current:unknown|null,proposed:unknown,scope:SchemaCompilationScope){
  const next=parseSchemaManifest(proposed),before=current===null?null:parseSchemaManifest(current);
  // Refuse unsupported or cross-installation transitions before normalization.
  compileProvisioningTransition(before,next,scope);
  const neutral={applicationId:asApplicationId("portable-schema"),installationId:asInstallationId("portable-installation")};
  const normalize=(m:SchemaManifest)=>createSchemaManifest(compileResourceSchema(m.canonicalIr.resources.map(r=>({...r,...neutral})),neutral));
  const normalizedNext=normalize(next),normalizedBefore=before?normalize(before):null;
  const normalizedPlan=compileProvisioningTransition(normalizedBefore,normalizedNext,neutral);
  const content=(m:SchemaManifest)=>hashPhysical(["VIBRESS-PORTABLE-SCHEMA-CONTENT-V1",PROVISIONING_PROFILE,m.schemaVersion,m.canonicalIr.resources,m.resources]);
  const contentDigest=content(normalizedNext),parentContentDigest=normalizedBefore?content(normalizedBefore):null;
  return {
    version:1 as const,profile:"PORTABLE_CONTENT_ONLY_V1" as const,authorization:"NONE" as const,
    contentDigest,parentContentDigest,
    transitionDigest:hashPhysical(["VIBRESS-PORTABLE-MIGRATION-CONTENT-V1",PROVISIONING_PROFILE,parentContentDigest,contentDigest,normalizedPlan.digest])
  };
}
