// Restricted disposable cluster-administrator protocol; no runtime export,
// credential rotation, generic SQL or backend signaling capability.
import type { ClientBase } from "pg";
import { randomUUID } from "node:crypto";

type ActorKind="AUTHOR"|"APPROVER";
type Ticket=Readonly<{nonce:string;installationId:string;databaseName:string;login:string;
  roleOid:string;oldInstance:string;principal:string;kind:ActorKind;systemId:string}>;
const tickets=new WeakSet<Ticket>();
function refuse():never{throw Error("disposable identity lifecycle refused; keep actor retired and NOLOGIN");}
function idle(c:ClientBase):boolean{
  const typed=c as ClientBase & {getTransactionStatus?:()=>string|null};
  return typeof typed.getTransactionStatus==="function" && typed.getTransactionStatus()==="I";
}
async function rootContext(db:ClientBase,cluster:ClientBase,installationId:string){
  if(process.env.NODE_ENV!=="test")return refuse();
  const read=async(c:ClientBase)=>(await c.query<{database:string;root:boolean;system:string;version:number}>(
    "SELECT current_database() AS database,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AND session_user=current_user AS root,"+
    "(SELECT system_identifier::text FROM pg_control_system()) AS system,current_setting('server_version_num')::int AS version")).rows[0];
  const target=await read(db),maintenance=await read(cluster);
  if(!target||!maintenance||!target.root||!maintenance.root||target.system!==maintenance.system||
    target.version<160000||target.version>=170000||maintenance.database!=="vibress"||!/^vibress_s03_[a-z0-9_]+$/.test(target.database))return refuse();
  const registry=(await db.query<{database_name:string;environment:string;operator_role:string;runtime_role:string}>(
    "SELECT database_name,environment,operator_role,runtime_role FROM public.platform_schema_registry WHERE installation_id=$1",[installationId])).rows[0];
  if(!registry||registry.database_name!==target.database||registry.environment!=="test"||!idle(db)||!idle(cluster))return refuse();
  return {target,registry};
}
async function role(cluster:ClientBase,login:string){
  const r=(await cluster.query<{oid:string;canlogin:boolean;safe:boolean;members:boolean}>(
    "SELECT oid::text,rolcanlogin AS canlogin,NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication) AS safe,"+
    "EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) AS members FROM pg_roles r WHERE rolname=$1",[login])).rows[0];
  if(!r||!r.safe)return refuse();
  return r;
}
async function quiescent(cluster:ClientBase,oid:string):Promise<boolean>{
  await cluster.query("SELECT pg_stat_clear_snapshot()");
  const n=(await cluster.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usesysid=$1::oid",[oid])).rows[0];
  return n?.n===0;
}
// Retirement is committed BEFORE native LOGIN fencing. An existing connection
// may persist; no completion ticket is usable until all those sessions exit.
// A compromised root or noncooperating administrator is outside the protocol.
export async function retireDisposableIdentity(db:ClientBase,cluster:ClientBase,installationId:string,login:string):Promise<Ticket>{
  const {target,registry}=await rootContext(db,cluster,installationId);
  if(!/^s03_(author|approver)_[a-z0-9_]+$/.test(login)||[registry.operator_role,registry.runtime_role].includes(login))return refuse();
  const native=await role(cluster,login);
  if(!native.canlogin)return refuse();
  const actor=(await db.query<{principal_id:string;actor_kind:ActorKind;actor_instance_id:string}>(
    "SELECT principal_id,actor_kind,actor_instance_id FROM public.platform_schema_trusted_actors WHERE login_name=$1 AND active",[login])).rows[0];
  if(!actor||!["AUTHOR","APPROVER"].includes(actor.actor_kind))return refuse();
  // Require idle dedicated root clients; avoid accidentally joining a caller transaction.
  if(!idle(db)||!idle(cluster))return refuse();
  await db.query("SELECT public.s03_p06_root_retire($1,$2)",[installationId,login]);
  await cluster.query("ALTER ROLE "+cluster.escapeIdentifier(login)+" NOLOGIN");
  const after=await role(cluster,login);
  if(after.oid!==native.oid||after.canlogin)return refuse();
  const ticket=Object.freeze({nonce:randomUUID(),installationId,databaseName:target.database,login,
    roleOid:native.oid,oldInstance:actor.actor_instance_id,principal:actor.principal_id,kind:actor.actor_kind,systemId:target.system});
  tickets.add(ticket);
  return ticket;
}
// Only disposable LOGIN cycling / metadata principal replacement. Actual
// credential compromise requires external credential rotation and verification;
// it is not silently treated as a routine password rotation.
export async function completeDisposableIdentity(db:ClientBase,cluster:ClientBase,ticket:Ticket,principal=ticket.principal):Promise<string>{
  if(!tickets.has(ticket)||!/^individual:[a-z0-9_:-]+$/.test(principal))return refuse();
  const {target}=await rootContext(db,cluster,ticket.installationId);
  const native=await role(cluster,ticket.login);
  if(target.system!==ticket.systemId||target.database!==ticket.databaseName||native.oid!==ticket.roleOid||native.canlogin||native.members||
    !await quiescent(cluster,ticket.roleOid))return refuse();
  const stale=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.platform_schema_trusted_actors WHERE login_name=$1 OR actor_instance_id=$2::uuid",[ticket.login,ticket.oldInstance])).rows[0];
  if(stale?.n!==0||!idle(db)||!idle(cluster))return refuse();
  // The delete result is the synchronous one-shot claim after async checks.
  // Competing completion must not execute another native privilege mutation.
  if(!tickets.delete(ticket))return refuse();
  try{
    await cluster.query("ALTER ROLE "+cluster.escapeIdentifier(ticket.login)+" LOGIN");
    const replacement=(await db.query<{id:string}>("SELECT public.s03_p06_root_register($1,$2,$3,$4) AS id",[ticket.installationId,ticket.login,principal,ticket.kind])).rows[0];
    if(!replacement||replacement.id===ticket.oldInstance)return refuse();
    return replacement.id;
  }catch(error){
    await cluster.query("ALTER ROLE "+cluster.escapeIdentifier(ticket.login)+" NOLOGIN");
    throw error;
  }
}
