// Test-only producer using the existing BullMQ transport.
import {Queue,QueueEvents} from "bullmq";
export function referenceQueue(name:string,prefix:string){
  const connection={host:"127.0.0.1",port:6380};
  return {queue:new Queue(name,{connection,prefix}),events:new QueueEvents(name,{connection,prefix})};
}
