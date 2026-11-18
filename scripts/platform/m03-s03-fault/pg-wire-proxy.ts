/**
 * Test-only loopback PostgreSQL wire proxy. Deliberately drops COMMIT's
 * CommandComplete response AFTER PostgreSQL emitted it, BEFORE the client
 * receives it. No SQL manipulation or production fault injection.
 *
 * Port and upstream are bound to 127.0.0.1. No payload logging.
 */
import net, { type Server, type Socket } from "node:net";
import { once } from "node:events";

export interface CommitAckDrop {
  readonly port: number;
  readonly serverCommitObserved: Promise<void>;
  close(): Promise<void>;
}
export async function startCommitAckDropProxy(): Promise<CommitAckDrop> {
  return startTransactionAckFaultProxy("COMMIT", "DROP");
}

/** Test-only real PostgreSQL wire fault for transaction-control acknowledgments. */
export async function startTransactionAckFaultProxy(command: "BEGIN" | "COMMIT", fault: "DROP" | "STALL"): Promise<CommitAckDrop> {
  return startStatementAckFaultProxy(command, fault);
}

export async function startStatementAckFaultProxy(command: "BEGIN" | "COMMIT" | "ALTER TABLE" | "UPDATE" | "INSERT" | "ROLLBACK", fault: "DROP" | "STALL" | "OBSERVE", onObserved?:()=>void): Promise<CommitAckDrop> {
  const marker = command === "BEGIN" ? "BEGIN ISOLATION LEVEL READ COMMITTED\u0000" :
    command === "ALTER TABLE" ? "ALTER TABLE " :
    command === "UPDATE" ? "UPDATE public.platform_schema_registry SET manifest" :
    command === "INSERT" ? "INSERT INTO public.s03_p06_completed_operations " : command+"\u0000";
  const clients = new Set<Socket>();
  const upstreams = new Set<Socket>();
  let resolveCommit: (() => void) | undefined;
  let rejectCommit: ((reason?: unknown) => void) | undefined;
  const serverCommitObserved = new Promise<void>((resolve, reject) => {
    resolveCommit = resolve;
    rejectCommit = reject;
  });
  const server: Server = net.createServer((downstream) => {
    const upstream = net.createConnection({ host: "127.0.0.1", port: 5433 });
    clients.add(downstream);
    upstreams.add(upstream);
    let armed = false;
    let held = Buffer.alloc(0);
    let seenCommit = false;
    let stalled = false;
    let tail = Buffer.alloc(0);
    downstream.on("data", (bytes: Buffer) => {
      // Known fixture statements only; tolerate packet fragmentation.
      if (!armed) {
        const combined=Buffer.concat([tail,bytes]);
        if(combined.includes(Buffer.from(marker,"utf8"))) {armed=true;tail=Buffer.alloc(0);}
        else tail=Buffer.from(combined.subarray(Math.max(0,combined.length-marker.length+1)));
      }
      if (!upstream.destroyed) upstream.write(bytes);
    });
    upstream.on("data", (bytes: Buffer) => {
      if (stalled) return;
      if (!armed) {
        if (!downstream.destroyed) downstream.write(bytes);
        return;
      }
      held = Buffer.concat([held, bytes]);
      if (held.length > 1048576) {
        downstream.destroy();
        upstream.destroy();
        rejectCommit?.(Error("PG_PROXY_EXCESSIVE_RESPONSE"));
        return;
      }
      while (held.length >= 5) {
        const size = held.readUInt32BE(1);
        if (size < 4 || size > 1048576) {
          downstream.destroy(); upstream.destroy();
          rejectCommit?.(Error("PG_PROXY_INVALID_FRAME"));
          return;
        }
        if (held.length < size + 1) return;
        const frame = held.subarray(0, size + 1);
        held = held.subarray(size + 1);
        if (frame[0] === 0x43 && frame.subarray(5).toString("utf8").startsWith(command)) {
          // Received PostgreSQL CommandComplete for COMMIT. Never deliver
          // this acknowledgment to the application client.
          seenCommit = true;
          resolveCommit?.();
          onObserved?.();
          if (fault === "OBSERVE") {
            if (!downstream.destroyed) downstream.write(frame);
            continue;
          }
          if (fault === "STALL") { stalled = true; return; }
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (!downstream.destroyed) downstream.write(frame);
      }
    });
    downstream.on("error", () => undefined);
    upstream.on("error", () => undefined);
    downstream.on("close", () => {
      clients.delete(downstream);
      upstream.destroy();
    });
    upstream.on("close", () => {
      upstreams.delete(upstream);
      downstream.destroy();
      if (armed && !seenCommit) {
        rejectCommit?.(Error("PG_PROXY_COMMIT_NOT_OBSERVED"));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw Error("PG_PROXY_INVALID_LISTENER");
  }
  return {
    port: address.port,
    serverCommitObserved,
    async close() {
      for (const client of clients) client.destroy();
      for (const upstream of upstreams) upstream.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(Error("PG_PROXY_CLOSE_FAILED")) : resolve()));
    },
  };
}
