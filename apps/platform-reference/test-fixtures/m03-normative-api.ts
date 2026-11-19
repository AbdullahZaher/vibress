// Test-only isolated reference entrypoint. Never registered by production API.
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {asApplicationId,asInstallationId,defineAction,defineApplication} from "@vibress/platform-kernel";
import {PolicyEngine,TenantUnitOfWork} from "@vibress/tenancy";
import {PlatformMembershipResolver} from "../../../packages/database/src/platform-application-registry";
import {createReferenceServer} from "../src/server";
import {ReferenceTokenDirectory} from "../src/token-directory";
declare const M03_SCHEMA_VERSION:1|2;
const version=M03_SCHEMA_VERSION;
const need=(key:string)=>{const value=process.env[key];if(!value)throw Error("missing reference config");return value;};
const ident=(value:string)=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error("bad reference identifier");return '"'+value+'"';};
const local=(value:string)=>{const u=new URL(value);if(process.env.NODE_ENV!=="test"||process.env.M03_NORMATIVE_REFERENCE!=="1"||u.hostname!=="127.0.0.1"||u.port!=="5433"||!/^\/vibress_s03_norm_[a-z0-9_]+$/.test(u.pathname))throw Error("isolated reference only");return value;};
async function main(){
  const applicationId=asApplicationId(need("M03_APP")),installationId=asInstallationId(need("M03_INSTALLATION")),
    table=ident(need("M03_NAMESPACE"))+"."+ident(need("M03_CUSTOMERS")),runtime=new Pool({connectionString:local(need("M03_RUNTIME_URL")),max:2}),
    reader=new Pool({connectionString:local(need("M03_MEMBERSHIP_URL")),max:2});
  try{
    const identity=(await runtime.query<{database:string;oid:string;role:string}>("SELECT current_database() AS database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,current_user AS role")).rows[0];
    if(!identity||identity.database!==need("M03_DATABASE")||identity.oid!==need("M03_OID")||identity.role!==need("M03_RUNTIME_ROLE"))throw Error("reference identity mismatch");
    const projection=version===2?"id,name,website":"id,name";
    await runtime.query("SELECT "+projection+" FROM "+table+" LIMIT 0");
    const permission="crm.customers.read",write="crm.customers.create";
    const application=defineApplication({id:applicationId,name:"Experimental generated CRM",version:version===1?"1.0.0":"2.0.0",
      actions:{
        listCustomers:defineAction({name:"listCustomers",permission,input:()=>null,handler:async({transaction})=>({version,customers:(await transaction.query("SELECT "+projection+" FROM "+table+" ORDER BY id LIMIT 100")).rows})}),
        createCustomer:defineAction({name:"createCustomer",permission:write,input:(input:unknown)=>{
          if(!input||typeof input!=="object"||Array.isArray(input))throw Error("bad customer");
          const v=input as Record<string,unknown>;
          if(Object.keys(v).some(k=>!["name","code",...(version===2?["website"]:[])].includes(k))||typeof v.name!=="string"||v.name.length<1||v.name.length>200||typeof v.code!=="string"||!/^[a-z0-9-]{1,40}$/.test(v.code)||
            version===2&&v.website!==undefined&&typeof v.website!=="string")throw Error("bad customer");
          return {name:v.name,code:v.code,website:typeof v.website==="string"?v.website:null};
        },handler:async({transaction,context,input})=>{
          if(!context.tenantId)throw Error("scope required");
          const args=[context.tenantId,randomUUID(),input.code,input.name];
          return (await transaction.query("INSERT INTO "+table+"(tenant_id,id,code,name"+(version===2?",website":"")+") VALUES($1,$2,$3,$4"+(version===2?",$5":"")+") RETURNING "+projection,version===2?[...args,input.website]:args)).rows[0];
        }})},
      http:[{method:"GET",path:"/crm/customers",action:"listCustomers",auth:"staff"},{method:"POST",path:"/crm/customers",action:"createCustomer",auth:"staff"}]});
    const server=await createReferenceServer({application,installationId,membershipResolver:new PlatformMembershipResolver(reader),unitOfWork:new TenantUnitOfWork(runtime),tokens:ReferenceTokenDirectory.fromJson(applicationId,need("M03_TOKENS")),policy:new PolicyEngine([{id:"read",action:permission,effect:"allow"},{id:"write",action:write,effect:"allow"}]),policyVersion:"reference-experimental-v1"});
    await server.app.listen({host:"127.0.0.1",port:0});
    const address=server.app.server.address();if(!address||typeof address==="string")throw Error("no reference address");
    process.send?.({kind:"ready",port:address.port,version});
    const close=async()=>{await server.app.close();await runtime.end();await reader.end();process.exitCode=0;process.disconnect?.();};
    process.once("SIGTERM",()=>{void close();});process.once("disconnect",()=>{void close();});
  }catch(error){await runtime.end().catch(()=>undefined);await reader.end().catch(()=>undefined);throw error;}
}
void main().catch(()=>{process.send?.({kind:"refused",version});process.exitCode=1;process.disconnect?.();});
