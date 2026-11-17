/**
 * M03-S03 Agent04 test-only PostgreSQL TCP transport fixture.
 *
 * This proxy is deliberately bound to loopback and connects only to the
 * explicitly disposable local PostgreSQL instance at 127.0.0.1:5433.
 * Delays actual socket bytes (not fake application sleeps).
 * No SQL content, protocol payloads or credentials are logged.
 *
 * Timing through this loopback proxy models transport latency; it does NOT
 * certify physical cross-region networking, production DNS or TLS.
 */
import net, { type Server, type Socket } from "node:net";
import { once } from "node:events";

type HandshakeMode = "normal" | "blackhole" | "disconnect";
export interface TransportProfile {
  readonly upstreamMs?: number;
  readonly downstreamMs?: number;
  readonly commitAckExtraMs?: number;
  /** Test-only loopback chaining for real on-wire COMMIT-ACK loss. */
  readonly upstreamPort?: number;
  readonly handshakeMode?: HandshakeMode;
}
export interface DisposableTransportProxy {
  readonly port: number;
  close(): Promise<void>;
}

export async function startDisposableTransportProxy(
  profile: TransportProfile,
): Promise<DisposableTransportProxy> {
  for (const delay of [profile.upstreamMs ?? 0, profile.downstreamMs ?? 0,
    profile.commitAckExtraMs ?? 0]) {
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 1000) {
      throw Error("BENCHMARK_TRANSPORT_DELAY_OUT_OF_BOUNDS");
    }
  }
  if (profile.upstreamPort !== undefined &&
    (!Number.isSafeInteger(profile.upstreamPort) || profile.upstreamPort < 1 ||
      profile.upstreamPort > 65535)) {
    throw Error("BENCHMARK_UPSTREAM_PORT_INVALID");
  }
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const delaySend = (ms: number, dest: Socket, data: Buffer) => {
    if (ms === 0) {
      if (!dest.destroyed) dest.write(data);
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!dest.destroyed) dest.write(data);
    }, ms);
    timers.add(timer);
  };
  const server: Server = net.createServer((downstream: Socket) => {
    sockets.add(downstream);
    downstream.on("error", () => undefined);
    downstream.on("close", () => sockets.delete(downstream));
    if (profile.handshakeMode === "blackhole") return;
    if (profile.handshakeMode === "disconnect") {
      downstream.destroy();
      return;
    }
    const upstream = net.createConnection({
      host: "127.0.0.1", port: profile.upstreamPort ?? 5433,
    });
    sockets.add(upstream);
    upstream.on("error", () => downstream.destroy());
    upstream.on("close", () => {
      sockets.delete(upstream);
      downstream.destroy();
    });
    downstream.on("close", () => upstream.destroy());
    let commitRequested = false;
    downstream.on("data", (bytes: Buffer) => {
      // Detect only the control tag; never decode or log any SQL payload.
      // Bare COMMIT is emitted in a simple Query protocol message.
      if (bytes.includes(Buffer.from("COMMIT\u0000"))) commitRequested = true;
      delaySend(profile.upstreamMs ?? 0, upstream, bytes);
    });
    upstream.on("data", (bytes: Buffer) => {
      delaySend(
        (profile.downstreamMs ?? 0) +
          (commitRequested ? (profile.commitAckExtraMs ?? 0) : 0),
        downstream, bytes,
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw Error("BENCHMARK_PROXY_NO_PORT");
  }
  return {
    port: address.port,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const sock of sockets) sock.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close(error =>
          error ? reject(Error("BENCHMARK_PROXY_CLEANUP_FAILED")) : resolve()),
      );
      if ([...sockets].some(sock => !sock.destroyed)) {
        throw Error("BENCHMARK_PROXY_LIVE_SOCKET_LEAK");
      }
      // Node may defer close events until after the server-close callback.
      sockets.clear();
    },
  };
}
