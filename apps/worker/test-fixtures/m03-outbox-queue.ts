// Test-only relay/consumer using the existing BullMQ transport at the
// disposable Redis instance. It carries already-enveloped outbox rows, so the
// producer and dispatcher under test are the production implementations.
import {Job,Queue,QueueEvents,Worker} from "bullmq";

const connection={host:"127.0.0.1",port:6380};

export interface OutboxRelayJobData {
  eventId:string;
  eventType:string;
  tenantId:string;
  applicationId:string;
  installationId:string;
  resourceId:string;
  recordId:string;
  versionToken:string;
  envelope:unknown;
}

export function outboxQueue(name:string){
  return {queue:new Queue<OutboxRelayJobData>(name,{connection}),events:new QueueEvents(name,{connection})};
}

export function outboxWorker(name:string,processor:(job:Job<OutboxRelayJobData>)=>Promise<unknown>){
  return new Worker<OutboxRelayJobData>(name,processor,{connection,concurrency:1});
}
