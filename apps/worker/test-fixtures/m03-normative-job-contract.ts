// Isolated reference workload only. Durable operation identity binds canonical
// work, while producer signature separately binds authorization and expiry.
import {createHash,verify,type KeyObject} from "node:crypto";
export const referenceAction="crm.customers.activity" as const;
export const referenceProducer="reference-producer" as const;
export interface ReferenceWork {
  version:1|2;applicationId:string;installationId:string;tenantId:string;
  producer:string;action:typeof referenceAction;nonce:string;customerId:string;website:string|null;
}
export interface ReferenceJob extends ReferenceWork {operationId:string;expiresAt:number;signature:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const branded=/^[a-z][a-z0-9_-]{1,62}$/;
const fail=():never=>{throw Error("M03_JOB_AUTHORIZATION_REFUSED");};
export function referenceWorkDigest(w:ReferenceWork){
  return createHash("sha256").update(JSON.stringify(["VIBRESS-M03-JOB-WORK-V1",w.version,w.applicationId,w.installationId,w.tenantId,w.producer,w.action,w.nonce,w.customerId,w.website])).digest("hex");
}
export function referenceOperationId(w:ReferenceWork){
  const id=referenceWorkDigest(w);
  // Version-8 UUID with 122 digest bits; entire 256-bit digest is persisted.
  return id.slice(0,8)+"-"+id.slice(8,12)+"-8"+id.slice(13,16)+"-"+((parseInt(id[16]!,16)&3)|8).toString(16)+id.slice(17,20)+"-"+id.slice(20,32);
}
export function referenceJobMessage(j:Omit<ReferenceJob,"signature">){
  return JSON.stringify(["VIBRESS-M03-JOB-AUTH-V1",referenceWorkDigest(j),j.operationId,j.expiresAt]);
}
export function verifyReferenceJob(raw:unknown,key:KeyObject,now:number):ReferenceJob{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();
  const j=raw as Record<string,unknown>,str=(v:unknown,re:RegExp):v is string=>typeof v==="string"&&re.test(v);
  const fields=["version","applicationId","installationId","tenantId","producer","action","nonce","customerId","website","operationId","expiresAt","signature"];
  if(Object.keys(j).length!==fields.length||Object.keys(j).some(k=>!fields.includes(k))||j.version!==1&&j.version!==2||
    !str(j.applicationId,branded)||!str(j.installationId,branded)||!str(j.tenantId,branded)||j.tenantId==="pub_default"||j.producer!==referenceProducer||j.action!==referenceAction||
    !str(j.nonce,uuid)||!str(j.customerId,uuid)||!str(j.operationId,uuid)||!str(j.signature,/^[A-Za-z0-9_-]{86}$/)||
    typeof j.expiresAt!=="number"||!Number.isSafeInteger(j.expiresAt)||j.expiresAt<=now||j.expiresAt>now+300000||
    (j.version===1?j.website!==null:typeof j.website!=="string"||j.website.length>2048||j.website.includes("\u0000")))return fail();
  const payload=j as unknown as ReferenceJob;
  if(key.asymmetricKeyType!=="ed25519"||!verify(null,Buffer.from(referenceJobMessage(payload)),key,Buffer.from(payload.signature,"base64url")))return fail();
  if(referenceOperationId(payload)!==payload.operationId)throw Error("M03_JOB_IDENTITY_CONFLICT");
  return payload;
}
