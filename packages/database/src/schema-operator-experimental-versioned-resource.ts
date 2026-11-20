// Internal disposable CORE V1 leaf-resource adapter. Uses the existing signed
// manifest, installer and TenantUnitOfWork; no new storage or public route.
// It deliberately does NOT implement distributed recovery admission or a
// generic soft-delete FK policy. Trusted callers must not expose arbitrary SQL.
import {createHash,randomUUID} from "node:crypto";
import {compileProvisioningContract,enforceBoundedJson,moneyCurrencyColumn,parseSchemaManifest,provisioningIdentifier as qi,validateMoney,PROVISIONING_PROFILE,type MoneyValue} from "@vibress/schema-engine";
import {CURRENT_STUDIO_VERSION,assertStudioDocumentEditable,checkDocumentResourceLimits,normalizeStudioDocument,validateStudioDocument} from "@vibress/studio-core";
import {assertVerifiedScope,hasPermission,type ScopedTransaction} from "@vibress/tenancy";
import type {DisposableDurableRecoveryAuthority} from "./schema-operator-experimental-durable-authority";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const codePattern=/^[a-z0-9-]{1,80}$/;
// Asset ids are the text primary key of the platform media contract (UUIDs,
// legacy med_* ids and other safe identifiers); the database CHECK mirrors it.
const mediaIdPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// Canonical BCP-47 subset used by the platform locale registry (en, ar-SA,
// zh-Hant-TW); noncanonical casing/separators are refused rather than guessed.
const localePattern=/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;
const refuse=():never=>{throw Error("M03_VERSIONED_RESOURCE_REFUSED");};
const refuseChildren=():never=>{throw Error("M03_VERSIONED_RESOURCE_CHILDREN")};
const validName=(name:unknown):name is string=>typeof name==="string"&&name.length>0&&name.length<=200&&!name.includes("\u0000");
type Row={id:string;code:string;name:string;version_token:string}&Record<string,unknown>;
type Page={records:Row[];nextCursor:string|null};
// `id`/`code` are the original scalar orders; a declaration tuple orders by a
// declared compound unique/index signature with `id` as the final tiebreaker.
type Order="id"|"code"|readonly string[];
type Field=
  |{name:string;kind:"text";maxLength?:number}
  |{name:string;kind:"boolean"|"datetime"|"integer"|"date"}
  |{name:string;kind:"decimal";precision:number;scale:number}
  |{name:string;kind:"enum";values:readonly string[]}
  |{name:string;kind:"money";precision:number;scale:number;currencyColumn:string}
  |{name:string;kind:"json"|"media"|"localized";maxBytes:number;maxDepth:number;maxKeys:number}
  |{name:string;kind:"studio";maxBytes:number;maxDepth:number;maxKeys:number}
  |{name:string;kind:"relation";required:boolean};
/**
 * Media references keep their platform identity; the host resolves that id in
 * the authenticated publication through its existing media repository.
 */
export interface TrustedMediaOwnership{
  readonly publicationId:string;
  findById(id:string,publicationId?:string):Promise<unknown>;
}
/**
 * Transaction-bound outbox port. `emit` must write through the transaction
 * that performed the mutation, so callers pass an adapter bound to `tx`.
 */
export interface VersionedResourceEvent{
  readonly id:string;
  readonly eventType:"m03.resource.created"|"m03.resource.updated"|"m03.resource.deleted";
  readonly payload:{
    readonly applicationId:string;
    readonly installationId:string;
    readonly tenantId:string;
    readonly resourceId:string;
    readonly recordId:string;
    readonly code:string;
    readonly versionToken:string;
  };
}
export interface VersionedResourceOutbox{
  emit(event:VersionedResourceEvent):Promise<void>;
}
const int4Min=-2147483648,int4Max=2147483647;
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const isPlainObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const validDate=(value:unknown):value is string=>{
  if(typeof value!=="string"||!isoDate.test(value))return false;
  const [year,month,day]=value.split("-").map(Number) as [number,number,number];
  if(month<1||month>12||day<1)return false;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  return day<=(month===2?(leap?29:28):[31,0,31,30,31,30,31,31,30,31,30,31][month-1]!);
};
const exactDecimal=(value:unknown,precision:number,scale:number):boolean=>{
  if(typeof value!=="string"||!/^-?\d{1,38}(?:\.\d{1,38})?$/.test(value))return false;
  const [whole="",fraction=""]=value.replace(/^-/,"").split(".");
  const integer=whole.replace(/^0+(?=\d)/,"").length;
  return fraction.length<=scale&&(integer<=precision-scale||(whole==="0"&&precision-scale===0));
};
type Identity={application_id:string;installation_id:string;epoch:string;ledger_id:string;manifest_digest:string;profile:string;revoked:boolean;runtime_role:string;role:string;session:string;db:string;oid:string;configured_db:string;configured_oid:string;system:string;configured_system:string;timeline:number;configured_timeline:number};

/**
 * The supported declaration is a tenant leaf with required text code/name/
 * version_token and optional datetime deleted_on. UUID versions are opaque,
 * regenerated by the service on each successful mutation. Soft deletion
 * retains the scoped unique key forever (no implicit identifier reuse).
 * Pagination uses keyset traversal over `id`, `(code,id)` or a declared
 * compound unique/index signature plus `id`; cursors are opaque and bound to
 * the manifest revision, ordering and equality filter that issued them, so a
 * cursor from another revision/order/filter is refused. It remains
 * per-transaction keyset traversal, not a snapshot. Equality filters cover
 * declared scalar fields; relation targets must be live and a parent cannot be
 * removed while live children still reference it.
 */
export async function openExperimentalVersionedResource(tx:ScopedTransaction,manifestWire:string,resourceId:string,authority:DisposableDurableRecoveryAuthority,media?:TrustedMediaOwnership,outbox?:VersionedResourceOutbox){
  if(process.env.NODE_ENV!=="test"||typeof manifestWire!=="string"||manifestWire.length>1024*1024)return refuse();
  assertVerifiedScope(tx.scope);
  const scope=tx.scope,initial=authority.authenticatedSnapshot(),last=initial.provisioningOperations?.filter(o=>o.outcome==="COMMITTED").at(-1);
  if(initial.pending||initial.businessLease||initial.readyProtocol===2||!last||last.epoch!==initial.epoch||last.applicationId!==scope.applicationId||initial.provisioningOperations?.some(o=>o.outcome==="ADMITTED"||o.outcome==="UNCERTAIN"))return refuse();
  const manifest=parseSchemaManifest(JSON.parse(manifestWire));
  const physical=compileProvisioningContract(manifest,{applicationId:scope.applicationId,installationId:manifest.installationId});
  if(JSON.stringify(manifest)!==manifestWire||manifest.installationId!==initial.installationId||manifest.digest!==last.manifestDigest||physical.digest!==last.physicalDigest)return refuse();
  const resource=physical.resources.find(r=>r.id===resourceId);
  if(!resource||resource.ownership!=="tenant"||resource.columns.length<6||resource.columns.length>18||JSON.stringify(resource.unique)!==JSON.stringify(["tenant_id","code"]))return refuse();
  const fixed=new Set(["id","tenant_id","code","name","version_token","deleted_on"]);
  for(const [name,type,required] of [["code","text",true],["name","text",true],["version_token","text",true],["deleted_on","timestamp with time zone",false]] as const){
    if(!resource.columns.some(c=>c.name===name&&c.type===type&&c.required===required&&!c.enumValues&&!c.target))return refuse();
  }
  // Beyond the fixed columns, declared fields are optional exact scalars,
  // bounded text, bounded JSON families, money pairs or same-ownership
  // relations admitted by the compiled physical contract.
  const declared=manifest.resources.find(r=>r.id===resourceId);
  if(!declared)return refuse();
  // Parent/child soft deletion is explicit. A relation target is admitted only
  // when it is a soft-deletable tenant resource, and this resource may itself be
  // a parent only when every child that references it is soft-deletable too;
  // otherwise the fixed-column contract cannot prove orphan avoidance.
  const softTable=(candidate:typeof resource)=>!!candidate&&candidate.ownership==="tenant"&&
    candidate.columns.some(c=>c.name==="tenant_id"&&c.type==="text"&&c.required&&!c.target&&!c.enumValues)&&
    candidate.columns.some(c=>c.name==="id"&&c.type==="uuid"&&c.required&&!c.target&&!c.enumValues)&&
    candidate.columns.some(c=>c.name==="deleted_on"&&c.type==="timestamp with time zone"&&!c.required&&!c.target&&!c.enumValues);
  const children:{table:string;column:string}[]=[];
  for(const origin of physical.resources)for(const relation of origin.relations)if(relation.table===resource.table){
    if(!softTable(origin)||!origin.columns.some(c=>c.name===relation.column&&c.type==="uuid")||relation.columns.length!==2||relation.targetColumns.length!==2)return refuse();
    if(!children.some(child=>child.table===origin.table&&child.column===relation.column))children.push({table:origin.table,column:relation.column});
  }
  // Media writes are admitted only with an authenticated publication scope that
  // can resolve each referenced asset; otherwise identity alone is insufficient.
  if(declared.fields.some(f=>f.logicalType==="media")&&(!media||typeof media.publicationId!=="string"||media.publicationId.length<1||media.publicationId.length>200||typeof media.findById!=="function"))return refuse();
  const fields:Field[]=[];
  for(const field of declared.fields){
    if(fixed.has(field.id))continue;
    const column=resource.columns.find(c=>c.name===field.id);
    if(!column)return refuse();
    if(field.logicalType==="relation"){
      const target=manifest.resources.find(r=>r.id===field.targetResource);
      if(field.required!==column.required||column.type!=="uuid"||!target||column.target!==target.tableName||target.ownership!=="tenant"||!resource.relations.some(r=>r.column===field.id&&r.table===target.tableName&&r.columns.length===2&&r.targetColumns.length===2))return refuse();
      fields.push({name:field.id,kind:"relation",required:column.required});
      continue;
    }
    if(field.required||column.required||column.target)return refuse();
    if(field.logicalType==="text"){
      if(column.type!=="text"||column.enumValues)return refuse();
      fields.push({name:field.id,kind:"text",...(field.maxLength!==undefined?{maxLength:field.maxLength}:{})});
    }else if(field.logicalType==="boolean"){
      if(column.type!=="boolean"||column.enumValues)return refuse();
      fields.push({name:field.id,kind:"boolean"});
    }else if(field.logicalType==="datetime"){
      if(column.type!=="timestamp with time zone"||column.enumValues)return refuse();
      fields.push({name:field.id,kind:"datetime"});
    }else if(field.logicalType==="integer"){
      if(column.type!=="integer"||column.enumValues)return refuse();
      fields.push({name:field.id,kind:"integer"});
    }else if(field.logicalType==="date"){
      if(column.type!=="date"||column.enumValues)return refuse();
      fields.push({name:field.id,kind:"date"});
    }else if(field.logicalType==="decimal"){
      if(field.precision===undefined||field.scale===undefined||column.type!=="numeric("+field.precision+","+field.scale+")"||column.enumValues)return refuse();
      fields.push({name:field.id,kind:"decimal",precision:field.precision,scale:field.scale});
    }else if(field.logicalType==="enum"){
      if(column.type!=="text"||!column.enumValues||!field.values||JSON.stringify(column.enumValues)!==JSON.stringify(field.values))return refuse();
      fields.push({name:field.id,kind:"enum",values:field.values});
    }else if(field.logicalType==="money"){
      const currencyColumn=moneyCurrencyColumn(field.id),currency=resource.columns.find(c=>c.name===currencyColumn),precision=field.precision??19,scale=field.scale??2;
      if(column.type!=="numeric("+precision+","+scale+")"||column.enumValues||!currency||currency.type!=="text"||currency.required||currency.enumValues||currency.target||declared.fields.some(f=>f.id===currencyColumn))return refuse();
      fields.push({name:field.id,kind:"money",precision,scale,currencyColumn});
    }else if(field.logicalType==="json"||field.logicalType==="media"||field.logicalType==="localized"||field.logicalType==="studio"){
      if(column.type!=="jsonb"||column.enumValues||field.maxBytes===undefined||field.maxDepth===undefined||field.maxKeys===undefined)return refuse();
      fields.push({name:field.id,kind:field.logicalType,maxBytes:field.maxBytes,maxDepth:field.maxDepth,maxKeys:field.maxKeys});
    }else return refuse();
  }
  const owned=fields.flatMap(f=>f.kind==="money"?[f.name,f.currencyColumn]:[f.name]);
  if(owned.length!==resource.columns.length-6||!resource.columns.every(c=>fixed.has(c.name)||owned.includes(c.name)))return refuse();
  const normalize=(field:Field,value:unknown):unknown=>{
    if(field.kind==="relation"){
      if(value===null)return field.required?refuse():null;
      return typeof value==="string"&&uuid.test(value)?value:refuse();
    }
    if(value===null)return null;
    switch(field.kind){
      case "boolean":return typeof value==="boolean"?value:refuse();
      case "text":return typeof value==="string"&&!value.includes("\u0000")&&(field.maxLength===undefined||value.length<=field.maxLength)?value:refuse();
      case "datetime":return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?value:refuse();
      case "date":return validDate(value)?value:refuse();
      case "integer":return typeof value==="number"&&Number.isInteger(value)&&value>=int4Min&&value<=int4Max?value:refuse();
      case "decimal":return exactDecimal(value,field.precision,field.scale)?value:refuse();
      case "enum":return typeof value==="string"&&field.values.includes(value)?value:refuse();
      case "money":{
        if(!isPlainObject(value)||Object.keys(value).some(key=>key!=="amount"&&key!=="currency"))return refuse();
        return validateMoney(field,value.amount,value.currency);
      }
      case "json":enforceBoundedJson(field,value);return value;
      case "media":{
        if(!isPlainObject(value)||typeof value.id!=="string"||!mediaIdPattern.test(value.id))return refuse();
        enforceBoundedJson(field,value);
        return value;
      }
      case "localized":{
        if(!isPlainObject(value))return refuse();
        const entries=Object.entries(value);
        if(entries.length===0)return refuse();
        for(const [locale,text] of entries){
          if(!localePattern.test(locale)||typeof text!=="string"||text.includes("\u0000"))return refuse();
        }
        enforceBoundedJson(field,value);
        return value;
      }
      case "studio":{
        if(!isPlainObject(value))return refuse();
        try{
          checkDocumentResourceLimits(value,{maxSizeBytes:field.maxBytes,maxDepth:field.maxDepth});
          const document=validateStudioDocument(normalizeStudioDocument(value));
          assertStudioDocumentEditable(document,document);
          if(document.version!==CURRENT_STUDIO_VERSION)return refuse();
          enforceBoundedJson(field,document);
          return document;
        }catch{return refuse();}
      }
    }
  };
  const valuesOf=(input:unknown):Map<string,unknown>=>{
    if(input===undefined)return new Map();
    if(!input||typeof input!=="object"||Array.isArray(input))return refuse();
    const record=input as Record<string,unknown>,out=new Map<string,unknown>();
    for(const [key,value] of Object.entries(record)){
      const field=fields.find(f=>f.name===key);
      if(!field)return refuse();
      out.set(key,normalize(field,value));
    }
    return out;
  };
  const verifyMedia=async(values:Map<string,unknown>)=>{
    for(const field of fields)if(field.kind==="media"){
      const value=values.get(field.name);
      if(value===undefined||value===null)continue;
      if(!(await media!.findById((value as {id:string}).id,media!.publicationId)))return refuse();
    }
  };
  const table=qi(physical.namespace)+"."+qi(resource.table),tenant=scope.tenantId;
  const relationTargets=new Map<string,{table:string;live:boolean}>();
  for(const field of fields)if(field.kind==="relation"){
    const declaredField=declared.fields.find(f=>f.id===field.name)!;
    const target=physical.resources.find(r=>r.id===declaredField.targetResource)!;
    relationTargets.set(field.name,{table:target.table,live:softTable(target)});
  }
  // A relation may only point at a live row in the same tenant. The FK proves
  // existence and tenancy; when the target is soft-deletable the adapter also
  // refuses references to tombstones, which the FK cannot express.
  const verifyRelations=async(values:Map<string,unknown>)=>{
    for(const [name,target] of relationTargets){
      const value=values.get(name);
      if(value===undefined||value===null)continue;
      if(!target.live)continue;
      const live=(await tx.query<{live:boolean}>("SELECT EXISTS(SELECT 1 FROM "+qi(physical.namespace)+"."+qi(target.table)+" WHERE tenant_id=$1 AND id=$2::uuid AND deleted_on IS NULL) AS live",[tenant,value])).rows[0];
      if(!live?.live)return refuse();
    }
  };
  const rows=(await tx.query<Identity>(`SELECT t.application_id,t.installation_id,t.epoch,t.ledger_id,r.manifest_digest,t.profile,t.revoked,t.runtime_role,current_user AS role,session_user AS session,current_database() AS db,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS oid,t.database_name AS configured_db,t.database_oid AS configured_oid,(pg_catalog.pg_control_system()).system_identifier::text AS system,t.system_identifier AS configured_system,(pg_catalog.pg_control_checkpoint()).timeline_id AS timeline,t.timeline AS configured_timeline FROM public.platform_schema_installation_trust_v1 t JOIN public.platform_schema_registry r USING(installation_id)`)).rows;
  const x=rows[0];
  if(rows.length!==1||!x||x.revoked||x.profile!==PROVISIONING_PROFILE||x.application_id!==scope.applicationId||x.installation_id!==initial.installationId||x.epoch!==initial.epoch||x.ledger_id!==initial.ledgerId||x.manifest_digest!==manifest.digest||x.db!==initial.databaseName||x.db!==x.configured_db||x.oid!==last.databaseOid||x.oid!==x.configured_oid||x.system!==x.configured_system||x.timeline!==x.configured_timeline||x.role!==x.session||x.role!==x.runtime_role)return refuse();
  const unchanged=()=>{
    if(JSON.stringify(initial)!==JSON.stringify(authority.authenticatedSnapshot())){
      tx.markRollbackOnly("versioned resource authority changed");
      return refuse();
    }
  };
  const allow=(action:string)=>{
    unchanged();
    if(!hasPermission(scope.authorization.permissions,"resource."+resourceId+"."+action))return refuse();
  };
  const cast=(field:Field)=>
    field.kind==="datetime"?"::timestamptz":
    field.kind==="date"?"::date":
    field.kind==="decimal"?"::numeric":
    field.kind==="json"||field.kind==="media"||field.kind==="localized"||field.kind==="studio"?"::jsonb":"";
  const projection="id::text AS id,code,name,version_token"+fields.flatMap(f=>f.kind==="money"?[f.name,f.currencyColumn]:[f.name]).map(c=>","+qi(c)).join("");
  // Money is one logical value over an exact amount and its currency
  // companion; rows expose the pair under the declared field name.
  const shape=(row:Row|null):Row|null=>{
    if(!row)return null;
    for(const field of fields)if(field.kind==="money"){
      const amount=row[field.name] as string|null,currency=row[field.currencyColumn] as string|null;
      delete row[field.currencyColumn];
      row[field.name]={amount,currency};
    }
    return row;
  };
  // Ordering/filtering is limited to declarations the compiler also emits as
  // scalar btree keys; compound order signatures must equal a declared unique
  // or index exactly, in declaration order.
  const orderable=new Map<string,Field>();
  for(const field of fields)if(field.kind!=="json"&&field.kind!=="media"&&field.kind!=="localized"&&field.kind!=="studio"&&field.kind!=="money"&&field.kind!=="relation")orderable.set(field.name,field);
  const declarations=Object.freeze([...(declared.uniques??[]),...(declared.indexes??[])]);
  const columnOf=(name:string)=>{
    if(name==="id")return{name,cast:"::uuid",kind:"uuid" as const};
    if(name==="code")return{name,cast:"::text",kind:"text" as const};
    const field=orderable.get(name);
    if(!field)return refuse();
    // Every keyset/filter parameter is explicitly typed; the OR-composed
    // null-aware predicate defeats PostgreSQL's contextual inference otherwise.
    const exact=field.kind==="text"||field.kind==="enum"?"::text":field.kind==="boolean"?"::boolean":field.kind==="integer"?"::int":cast(field);
    return{name,cast:exact,kind:field.kind};
  };
  // Row values of date/timestamptz columns surface as Date instances; cursor
  // keys are canonical strings so a cursor survives JSON round-trips.
  const serialize=(kind:string,value:unknown):unknown=>{
    if(kind==="uuid"||kind==="text"||kind==="enum"||kind==="decimal")return typeof value==="string"?value:refuse();
    if(kind==="integer")return typeof value==="number"&&Number.isInteger(value)?value:refuse();
    if(kind==="boolean")return typeof value==="boolean"?value:refuse();
    if(value instanceof Date)return value.toISOString();
    return typeof value==="string"?value:refuse();
  };
  const keyset=(columns:readonly ReturnType<typeof columnOf>[],key:readonly unknown[],params:unknown[])=>{
    const indexes=key.map(value=>{params.push(value);return params.length;});
    // Default ASC ordering places NULLs last, so a NULL row is greater than any
    // non-null cursor value and a NULL cursor has no non-null successors.
    const eq=(column:ReturnType<typeof columnOf>,index:number)=>`(${qi(column.name)} IS NOT DISTINCT FROM $${index}${column.cast})`;
    const gt=(column:ReturnType<typeof columnOf>,index:number)=>`($${index}${column.cast} IS NOT NULL AND (${qi(column.name)} IS NULL OR ${qi(column.name)} > $${index}${column.cast}))`;
    const terms:string[]=[];
    for(let i=0;i<columns.length;i++){
      const parts:string[]=[];
      for(let j=0;j<i;j++)parts.push(eq(columns[j]!,indexes[j]!));
      parts.push(gt(columns[i]!,indexes[i]!));
      terms.push("("+parts.join(" AND ")+")");
    }
    return "("+terms.join(" OR ")+")";
  };
  const encodeV1=(order:"id"|"code",row:Row)=>"v1."+Buffer.from(JSON.stringify([manifest.digest,order,order==="id"?row.id:[row.code,row.id]])).toString("base64url");
  const decodeV1=(order:"id"|"code",after:string):unknown[]=>{
    if(!after.startsWith("v1.")||after.length>512)return refuse();
    let parsed:unknown;
    try{parsed=JSON.parse(Buffer.from(after.slice(3),"base64url").toString("utf8"));}catch{return refuse();}
    if(!Array.isArray(parsed)||parsed.length!==3||parsed[0]!==manifest.digest||parsed[1]!==order)return refuse();
    const key=parsed[2];
    if(order==="id")return typeof key==="string"&&uuid.test(key)?[key]:refuse();
    if(!Array.isArray(key)||key.length!==2||typeof key[0]!=="string"||!codePattern.test(key[0])||typeof key[1]!=="string"||!uuid.test(key[1]))return refuse();
    return [key[0],key[1]];
  };
  // The event identity is deterministic over the committed scope, record and
  // version token, so replaying the same logical mutation maps to one row.
  const eventId=(eventType:VersionedResourceEvent["eventType"],recordId:string,versionToken:string)=>createHash("sha256").update(JSON.stringify(["VIBRESS-M03-RESOURCE-EVENT-V1",initial.installationId,scope.applicationId,scope.tenantId,resourceId,recordId,eventType,versionToken])).digest("hex");
  const publish=async(eventType:VersionedResourceEvent["eventType"],row:{id:string;code:string;version_token:string})=>{
    if(!outbox)return;
    await outbox.emit({id:eventId(eventType,row.id,row.version_token),eventType,payload:{applicationId:scope.applicationId,installationId:initial.installationId,tenantId:scope.tenantId,resourceId,recordId:row.id,code:row.code,versionToken:row.version_token}});
  };
  return {
    async create(code:string,name:string,input?:unknown):Promise<Row>{
      allow("create");
      if(typeof code!=="string"||!codePattern.test(code)||!validName(name))return refuse();
      const values=valuesOf(input);await verifyMedia(values);await verifyRelations(values);
      const recordId=randomUUID(),token=randomUUID();
      const columns=["tenant_id","id","code","name","version_token","deleted_on"],params:unknown[]=[tenant,recordId,code,name,token,null],casts=["","","","","",""];
      for(const field of fields)if(field.kind==="relation"&&field.required&&!values.has(field.name))return refuse();
      for(const field of fields){
        const value=values.get(field.name)??null;
        if(field.kind==="money"){
          const pair=value as MoneyValue|null;
          columns.push(field.name,field.currencyColumn);params.push(pair?.amount??null,pair?.currency??null);casts.push("::numeric","");
        }else{columns.push(field.name);params.push(value);casts.push(cast(field));}
      }
      const placeholders=columns.map((_,index)=>"$"+(index+1)+casts[index]);
      const result=await tx.query<Row>("INSERT INTO "+table+"("+columns.map(qi).join(",")+") VALUES("+placeholders.join(",")+") RETURNING "+projection,params);
      unchanged();
      const created=shape(result.rows[0]??null);
      if(result.rowCount!==1||!created)return refuse();
      await publish("m03.resource.created",created);
      return created;
    },
    async update(id:string,expectedVersion:string,name:string,input?:unknown):Promise<Row|null>{
      allow("update");
      if(typeof id!=="string"||!uuid.test(id)||typeof expectedVersion!=="string"||!uuid.test(expectedVersion)||!validName(name))return refuse();
      const values=valuesOf(input);await verifyMedia(values);await verifyRelations(values);
      const token=randomUUID();
      const params:unknown[]=[tenant,id,expectedVersion,name,token];
      let set="name=$4,version_token=$5";
      for(const field of fields){
        if(!values.has(field.name))continue;
        if(field.kind==="money"){
          const pair=values.get(field.name) as MoneyValue|null;
          params.push(pair?.amount??null);set+=","+qi(field.name)+"=$"+params.length+"::numeric";
          params.push(pair?.currency??null);set+=","+qi(field.currencyColumn)+"=$"+params.length;
        }else{
          params.push(values.get(field.name));
          set+=","+qi(field.name)+"=$"+params.length+cast(field);
        }
      }
      const result=await tx.query<Row>("UPDATE "+table+" SET "+set+" WHERE tenant_id=$1 AND id=$2::uuid AND version_token=$3 AND deleted_on IS NULL RETURNING "+projection,params);
      unchanged();
      const updated=shape(result.rows[0]??null);
      if(!updated)return null;
      await publish("m03.resource.updated",updated);
      return updated;
    },
    async remove(id:string,expectedVersion:string):Promise<boolean>{
      allow("delete");
      if(typeof id!=="string"||!uuid.test(id)||typeof expectedVersion!=="string"||!uuid.test(expectedVersion))return refuse();
      const token=randomUUID();
      const result=await tx.query<{code:string}>("UPDATE "+table+" SET deleted_on=clock_timestamp(),version_token=$4 WHERE tenant_id=$1 AND id=$2::uuid AND version_token=$3 AND deleted_on IS NULL RETURNING code",[tenant,id,expectedVersion,token]);
      if(result.rowCount!==1){unchanged();return false;}
      // Soft deletion of a parent is refused while any adapter-visible child
      // still references it; the rollback prevents the tombstone from committing.
      for(const child of children){
        const live=(await tx.query<{live:boolean}>("SELECT EXISTS(SELECT 1 FROM "+qi(physical.namespace)+"."+qi(child.table)+" WHERE tenant_id=$1 AND "+qi(child.column)+"=$2::uuid AND deleted_on IS NULL) AS live",[tenant,id])).rows[0];
        if(live?.live){tx.markRollbackOnly("resource still has live children");return refuseChildren();}
      }
      unchanged();
      await publish("m03.resource.deleted",{id,code:result.rows[0]!.code,version_token:token});
      return true;
    },
    async list(limit:number,after:string|null=null,code:string|null=null,order:Order="id",filter:Record<string,unknown>={}):Promise<Page>{
      allow("read");
      if(!Number.isInteger(limit)||limit<1||limit>100||after!==null&&typeof after!=="string"||code!==null&&(typeof code!=="string"||!codePattern.test(code)))return refuse();
      const compound=order!=="id"&&order!=="code";
      const signature=compound?(order as readonly string[]).join(","):order as string;
      let orderColumns:ReturnType<typeof columnOf>[];
      if(compound){
        const declaration=order as readonly string[];
        if(!Array.isArray(declaration)||declaration.length<1||declaration.length>4||!declarations.some(d=>d.join(",")===signature))return refuse();
        orderColumns=[...declaration.map(columnOf),columnOf("id")];
      }else orderColumns=order==="id"?[columnOf("id")]:[columnOf("code"),columnOf("id")];
      if(!filter||typeof filter!=="object"||Array.isArray(filter))return refuse();
      const filters:(readonly [Field,unknown])[]=[];
      for(const [name,value] of Object.entries(filter)){
        const field=orderable.get(name);
        if(!field||value===null||typeof value==="object")return refuse();
        filters.push([field,serialize(field.kind,normalize(field,value))]);
      }
      filters.sort((a,b)=>a[0].name<b[0].name?-1:a[0].name>b[0].name?1:0);
      const filterPairs=filters.map(([field,value])=>[field.name,value] as const);
      const bound=compound||filters.length>0;
      let key:unknown[]|null=null;
      if(after!==null){
        if(!bound){key=decodeV1(order as "id"|"code",after);}
        else{
          if(!after.startsWith("v2.")||after.length>1024)return refuse();
          let parsed:unknown;
          try{parsed=JSON.parse(Buffer.from(after.slice(3),"base64url").toString("utf8"));}catch{return refuse();}
          if(!Array.isArray(parsed)||parsed.length!==4||parsed[0]!==manifest.digest||parsed[1]!==signature||JSON.stringify(parsed[2])!==JSON.stringify(filterPairs))return refuse();
          const values=parsed[3];
          if(!Array.isArray(values)||values.length!==orderColumns.length)return refuse();
          key=values.map((value,index)=>serialize(orderColumns[index]!.kind,value));
        }
      }
      const params:unknown[]=[tenant];
      const where=["tenant_id=$1","deleted_on IS NULL"];
      if(code!==null){params.push(code);where.push("code=$"+params.length+"::text");}
      for(const [field,value] of filters){params.push(value);where.push(qi(field.name)+"=$"+params.length+cast(field));}
      if(key!==null)where.push(keyset(orderColumns,key,params));
      params.push(limit+1);
      const result=await tx.query<Row>("SELECT "+projection+" FROM "+table+" WHERE "+where.join(" AND ")+" ORDER BY "+orderColumns.map(column=>qi(column.name)).join(",")+" LIMIT $"+params.length+"::int",params);
      unchanged();
      const records=result.rows.slice(0,limit).map(row=>shape(row)!);
      if(result.rows.length<=limit)return{records,nextCursor:null};
      const last=records.at(-1)!;
      if(!bound)return{records,nextCursor:encodeV1(order as "id"|"code",last)};
      const values=orderColumns.map(column=>serialize(column.kind,last[column.name]));
      return{records,nextCursor:"v2."+Buffer.from(JSON.stringify([manifest.digest,signature,filterPairs,values])).toString("base64url")};
    },
  };
}
