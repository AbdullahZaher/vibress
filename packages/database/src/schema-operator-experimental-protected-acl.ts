// Versioned authority policy for the isolated PG16 CORE V1 profile.
// The database owner is the explicitly trusted root provisioner, not an
// application principal. Catalog ACLs are observations, never the policy.
// This verifier is not a sandbox against concurrent trusted-superuser DDL.
import type {QueryResultRow} from "pg";
export const PROTECTED_ACL_PROFILE="M03_PROTECTED_ACL_V1" as const;
type Query=<T extends QueryResultRow>(sql:string,values?:unknown[])=>Promise<{rows:T[]}>;
const fail=():never=>{throw Error("M03_PROVISIONING_REFUSED:PROTECTED_ACL_V1");};
const tablePrivileges=["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"];
const columnPrivileges=["SELECT","INSERT","UPDATE","REFERENCES"];
type Policy={installer?:readonly string[];installerColumns?:Record<string,readonly string[]>;runtimeColumns?:Record<string,readonly string[]>};
const metadata:Record<string,Policy>={
  platform_applications:{},
  platform_installations:{},
  platform_schema_registry:{installer:["SELECT","INSERT"],installerColumns:{UPDATE:["manifest","manifest_digest","updated_at"]},runtimeColumns:{SELECT:["installation_id","manifest_digest"]}},
  platform_schema_installation_trust_v1:{installer:["SELECT"],runtimeColumns:{SELECT:["installation_id","application_id","database_name","database_oid","system_identifier","timeline","epoch","ledger_id","profile","revoked","runtime_role","approval_key","approval_key_digest"]}},
  platform_schema_revisions_v1:{installer:["SELECT","INSERT"]},
  platform_schema_backfill_chunks_v1:{installer:["SELECT","INSERT"]},
  platform_schema_recovery_reattestations_v1:{},
  platform_schema_business_witnesses_v1:{runtimeColumns:{INSERT:["operation_id","evidence","signature"]}},
  platform_schema_revision_states_v1:{installer:["SELECT","INSERT"],installerColumns:{UPDATE:["state","state_version","operation_id","approval_id","authority_epoch","authority_head","authority_sequence","actor","updated_at"]}},
  platform_schema_state_transitions_v1:{installer:["INSERT"]},
  platform_schema_plans:{},
  platform_schema_approvals:{},
  platform_schema_migration_journal:{}
};
const equal=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const edge=(grantee:string,grantor:string,privilege:string)=>JSON.stringify([grantee,grantor,privilege,false]);
export async function verifyProtectedMetadataAuthority(query:Query,installer:string,runtime:string,namespace:string){
  const roots=(await query<{name:string;trusted:boolean}>("SELECT r.rolname::text AS name,r.rolsuper AS trusted FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()")).rows;
  const root=roots[0]?.name;
  if(roots.length!==1||!root||!roots[0]?.trusted||root===installer||root===runtime||installer===runtime)return fail();
  const roles=[installer,runtime],names=Object.keys(metadata);
  const unsafe=(await query<{bad:boolean}>(`SELECT
    (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname=ANY($1::name[]) AND rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles a ON a.oid=m.roleid JOIN pg_catalog.pg_roles b ON b.oid=m.member WHERE a.rolname=ANY($1::name[]) OR b.rolname=ANY($1::name[]))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole WHERE r.rolname=ANY($2::name[]) OR d.defaclnamespace IN (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname IN ('public',$3)))
    OR EXISTS(SELECT 1 FROM unnest($1::text[]) r WHERE has_database_privilege(r,current_database(),'CREATE') OR has_database_privilege(r,current_database(),'TEMP') OR NOT has_database_privilege(r,current_database(),'CONNECT') OR has_schema_privilege(r,'public','CREATE') OR NOT has_schema_privilege(r,'public','USAGE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n CROSS JOIN unnest($1::text[]) r WHERE n.nspname NOT IN ('public',$3,'pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND (has_schema_privilege(r,n.oid,'CREATE') OR has_schema_privilege(r,n.oid,'USAGE')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest($1::text[]) r WHERE n.nspname NOT IN ($3,'pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND NOT (n.nspname='public' AND c.relname=ANY($4::name[])) AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') WHEN c.relkind='S' THEN has_sequence_privilege(r,c.oid,'USAGE,SELECT,UPDATE') ELSE false END)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN unnest($1::text[]) r WHERE (n.nspname NOT IN ('pg_catalog','information_schema') OR p.prosecdef) AND n.nspname !~ '^pg_(toast|temp)' AND has_schema_privilege(r,n.oid,'USAGE') AND has_function_privilege(r,p.oid,'EXECUTE'))
    AS bad`,[roles,[...roles,root],namespace,names])).rows[0];
  if(!unsafe||unsafe.bad)return fail();
  const schema=(await query<{owner:string;edges:string[];allowed:boolean}>(`SELECT pg_get_userbyid(n.nspowner) AS owner, ARRAY(SELECT jsonb_build_array(CASE WHEN e.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,pg_get_userbyid(e.grantor),e.privilege_type,e.is_grantable)::text FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) e) AS edges,
    (has_schema_privilege($1,n.oid,'CREATE') AND has_schema_privilege($1,n.oid,'USAGE') AND has_schema_privilege($2,n.oid,'USAGE') AND NOT has_schema_privilege($2,n.oid,'CREATE') AND NOT has_schema_privilege($2,n.oid,'USAGE WITH GRANT OPTION')) AS allowed
    FROM pg_catalog.pg_namespace n WHERE n.nspname=$3`,[installer,runtime,namespace])).rows[0];
  if(!schema||schema.owner!==installer||!schema.allowed||!equal(schema.edges.map(e=>JSON.stringify(JSON.parse(e))),[edge(installer,installer,"CREATE"),edge(installer,installer,"USAGE"),edge(runtime,installer,"USAGE")]))return fail();
  const tables=(await query<{name:string;owner:string;kind:string;edges:string[]}>(`SELECT c.relname::text AS name,pg_get_userbyid(c.relowner) AS owner,c.relkind AS kind,
    ARRAY(SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)::text FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a) AS edges
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::name[])`,[names])).rows;
  if(tables.length!==names.length)return fail();
  // JSONB text inserts spaces; canonicalize the observed edge tuple only.
  const canonical=(edges:string[])=>edges.map(e=>JSON.stringify(JSON.parse(e)));
  for(const t of tables){
    const policy=metadata[t.name];
    if(!policy||t.owner!==root||t.kind!=="r"||!equal(canonical(t.edges),[...tablePrivileges.map(p=>edge(root,root,p)),...(policy.installer??[]).map(p=>edge(installer,root,p))]))return fail();
  }
  const columns=(await query<{name:string;column:string;edges:string[]}>(`SELECT c.relname::text AS name,a.attname::text AS "column",
    ARRAY(SELECT jsonb_build_array(CASE WHEN e.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,pg_get_userbyid(e.grantor),e.privilege_type,e.is_grantable)::text FROM aclexplode(CASE WHEN cardinality(a.attacl)>0 THEN a.attacl ELSE NULL END) e) AS edges
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=ANY($1::name[]) AND a.attnum>0 AND NOT a.attisdropped`,[names])).rows;
  for(const c of columns){
    const p=metadata[c.name];
    if(!p)return fail();
    const expected=[...Object.entries(p.installerColumns??{}).filter(([,cols])=>cols.includes(c.column)).map(([priv])=>edge(installer,root,priv)),...Object.entries(p.runtimeColumns??{}).filter(([,cols])=>cols.includes(c.column)).map(([priv])=>edge(runtime,root,priv))];
    if(!equal(canonical(c.edges),expected))return fail();
  }
  for(const [name,p] of Object.entries(metadata))for(const col of [...Object.values(p.installerColumns??{}).flat(),...Object.values(p.runtimeColumns??{}).flat()])if(!columns.some(c=>c.name===name&&c.column===col))return fail();
  const effective=(await query<{name:string;role:string;column:string|null;privilege:string;allowed:boolean;grantable:boolean}>(`SELECT c.relname::text AS name,r.role,NULL::text AS "column",p.privilege,has_table_privilege(r.role,c.oid,p.privilege) AS allowed,has_table_privilege(r.role,c.oid,p.privilege||' WITH GRANT OPTION') AS grantable FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest($2::text[]) r(role) CROSS JOIN unnest($3::text[]) p(privilege) WHERE n.nspname='public' AND c.relname=ANY($1::name[])
    UNION ALL SELECT c.relname::text,r.role,a.attname::text,p.privilege,has_column_privilege(r.role,c.oid,a.attnum,p.privilege),has_column_privilege(r.role,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid CROSS JOIN unnest($2::text[]) r(role) CROSS JOIN unnest($4::text[]) p(privilege) WHERE n.nspname='public' AND c.relname=ANY($1::name[]) AND a.attnum>0 AND NOT a.attisdropped`,[names,roles,tablePrivileges,columnPrivileges])).rows;
  if(effective.length!==2*(names.length*tablePrivileges.length+columns.length*columnPrivileges.length))return fail();
  for(const e of effective){
    const p=metadata[e.name];
    if(!p)return fail();
    const isInstaller=e.role===installer,tableAllowed=isInstaller&&(p.installer??[]).includes(e.privilege);
    const expected=tableAllowed||(e.column!==null&&((isInstaller?p.installerColumns:p.runtimeColumns)?.[e.privilege]??[]).includes(e.column));
    if(e.allowed!==expected||e.grantable)return fail();
  }
  const routine=(await query<{name:string;owner:string;edges:string[];allowed:boolean}>(`SELECT p.proname::text AS name,pg_get_userbyid(p.proowner) AS owner,
    ARRAY(SELECT jsonb_build_array(CASE WHEN e.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,pg_get_userbyid(e.grantor),e.privilege_type,e.is_grantable)::text FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) e) AS edges,
    (SELECT bool_and(has_function_privilege(r,p.oid,'EXECUTE') AND NOT has_function_privilege(r,p.oid,'EXECUTE WITH GRANT OPTION')) FROM unnest($1::text[]) r) AS allowed
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND p.proname IN ('pg_control_system','pg_control_checkpoint') AND p.pronargs=0`,[roles])).rows;
  if(routine.length!==2||routine.some(x=>x.owner!==root||!x.allowed||!equal(canonical(x.edges),[edge(root,root,"EXECUTE"),edge(installer,root,"EXECUTE"),edge(runtime,root,"EXECUTE")])))return fail();
}

// Runtime can read catalog ownership without adding SELECT on protected trust
// columns. In this disposable profile the namespace owner must match every
// independently defined installer delegation; root is the trusted maintainer.
// Installer/recovery paths additionally compare the persisted installer identity.
export async function verifyRuntimeProtectedMetadataAuthority(query:Query,runtime:string,namespace:string){
  const rows=(await query<{owner:string}>("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace WHERE nspname=$1",[namespace])).rows;
  if(rows.length!==1||!rows[0]?.owner)return fail();
  await verifyProtectedMetadataAuthority(query,rows[0].owner,runtime,namespace);
}
