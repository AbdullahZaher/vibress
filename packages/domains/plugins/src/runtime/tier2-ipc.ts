import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const TIER2_IPC_VERSION = 1;
export const TIER2_MAX_FRAME_BYTES = 64 * 1024; // 64 KiB
export const TIER2_DEFAULT_MAX_SKEW_MS = 10_000; // 10 seconds

const sha256Regex = /^[a-f0-9]{64}$/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tier2IpcMessageType =
  | "invoke"
  | "response"
  | "capability_request"
  | "capability_response"
  | "ping"
  | "pong"
  | "terminate";

export interface Tier2IpcEnvelope<T = unknown> {
  readonly version: 1;
  readonly id: string;
  readonly correlationId?: string | undefined;
  readonly timestamp: number;
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly publicationId: string;
  readonly type: Tier2IpcMessageType;
  readonly payload: T;
  readonly hmacSha256: string;
}

const envelopeSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(uuidRegex),
  correlationId: z.string().regex(uuidRegex).optional(),
  timestamp: z.number().int().positive(),
  pluginId: z.string().min(1).max(100),
  releaseDigest: z.string().min(8).max(128),
  publicationId: z.string().min(1).max(200),
  type: z.enum([
    "invoke",
    "response",
    "capability_request",
    "capability_response",
    "ping",
    "pong",
    "terminate",
  ]),
  payload: z.unknown(),
  hmacSha256: z.string().regex(sha256Regex),
}).strict();

export class Tier2IpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Tier2IpcError";
  }
}

function computeHmac(
  fields: {
    version: number;
    id: string;
    correlationId?: string | undefined;
    timestamp: number;
    pluginId: string;
    releaseDigest: string;
    publicationId: string;
    type: string;
    payload: unknown;
  },
  secretKey: string,
): string {
  const content = JSON.stringify([
    fields.version,
    fields.id,
    fields.correlationId || "",
    fields.timestamp,
    fields.pluginId,
    fields.releaseDigest,
    fields.publicationId,
    fields.type,
    fields.payload,
  ]);
  return createHmac("sha256", secretKey).update(content).digest("hex");
}

/**
 * Signs an IPC envelope using an ephemeral session secret negotiated between
 * Host and the supervised child process.
 */
export function signTier2IpcEnvelope<T>(
  data: Omit<Tier2IpcEnvelope<T>, "version" | "id" | "timestamp" | "hmacSha256"> & {
    id?: string | undefined;
    correlationId?: string | undefined;
    timestamp?: number | undefined;
  },
  secretKey: string,
): Tier2IpcEnvelope<T> {
  if (!secretKey || secretKey.length < 32) {
    throw new Tier2IpcError("INVALID_IPC_SECRET", "IPC secret key must be at least 32 characters");
  }
  const id = data.id || randomUUID();
  const timestamp = data.timestamp || Date.now();
  const envelopeData = {
    version: 1 as const,
    id,
    ...(data.correlationId ? { correlationId: data.correlationId } : {}),
    timestamp,
    pluginId: data.pluginId,
    releaseDigest: data.releaseDigest,
    publicationId: data.publicationId,
    type: data.type,
    payload: data.payload,
  };
  const hmacSha256 = computeHmac(envelopeData, secretKey);
  return {
    ...envelopeData,
    hmacSha256,
  };
}

/**
 * Validates message version, schema, timestamp freshness, and cryptographic authenticity.
 */
export function verifyTier2IpcEnvelope<T = unknown>(
  raw: unknown,
  secretKey: string,
  options?: { maxSkewMs?: number | undefined; now?: number | undefined },
): Tier2IpcEnvelope<T> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Tier2IpcError("IPC_INVALID_ENVELOPE", `Envelope failed schema validation: ${parsed.error.message}`);
  }
  const envelope = parsed.data as Tier2IpcEnvelope<T>;

  const now = options?.now ?? Date.now();
  const maxSkew = options?.maxSkewMs ?? TIER2_DEFAULT_MAX_SKEW_MS;
  if (Math.abs(now - envelope.timestamp) > maxSkew) {
    throw new Tier2IpcError("IPC_TIMESTAMP_EXPIRED", "IPC envelope timestamp is outside permitted skew window");
  }

  const expectedHmac = computeHmac(envelope, secretKey);
  const expectedBuf = Buffer.from(expectedHmac, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(envelope.hmacSha256, "hex");
  } catch {
    throw new Tier2IpcError("IPC_AUTHENTICATION_FAILED", "Invalid HMAC format");
  }

  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new Tier2IpcError("IPC_AUTHENTICATION_FAILED", "IPC message cryptographic authentication failed");
  }

  return envelope;
}

/**
 * Length-prefixed framing for stream-based IPC (4-byte unsigned big-endian length + JSON).
 */
export function encodeTier2IpcFrame(envelope: Tier2IpcEnvelope): Buffer {
  const payloadBuf = Buffer.from(JSON.stringify(envelope), "utf8");
  if (payloadBuf.length > TIER2_MAX_FRAME_BYTES) {
    throw new Tier2IpcError("IPC_FRAME_TOO_LARGE", `Frame size ${payloadBuf.length} exceeds limit of ${TIER2_MAX_FRAME_BYTES}`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payloadBuf.length, 0);
  return Buffer.concat([header, payloadBuf]);
}

export function decodeTier2IpcFrame(buffer: Buffer): { envelope: Tier2IpcEnvelope; remaining: Buffer } | null {
  if (buffer.length < 4) return null;
  const frameLength = buffer.readUInt32BE(0);
  if (frameLength > TIER2_MAX_FRAME_BYTES) {
    throw new Tier2IpcError("IPC_FRAME_TOO_LARGE", `Incoming frame length ${frameLength} exceeds limit of ${TIER2_MAX_FRAME_BYTES}`);
  }
  if (buffer.length < 4 + frameLength) return null;
  const frameBytes = buffer.subarray(4, 4 + frameLength);
  const remaining = Buffer.from(buffer.subarray(4 + frameLength));
  let parsed: unknown;
  try {
    parsed = JSON.parse(frameBytes.toString("utf8"));
  } catch {
    throw new Tier2IpcError("IPC_MALFORMED_JSON", "Malformed JSON frame received on IPC channel");
  }
  return { envelope: parsed as Tier2IpcEnvelope, remaining };
}

/**
 * Bounded, authenticated IPC stream reader for stdio / pipe transports.
 * Enforces frame size boundaries, buffer overflow protection, and HMAC authentication.
 */
export class StreamIpcReader {
  private buffer = Buffer.alloc(0);
  private readonly maxBufferSize: number;
  private readonly secretKey: string;
  private readonly envelopeListeners: Array<(envelope: Tier2IpcEnvelope) => void> = [];
  private readonly errorListeners: Array<(error: Error) => void> = [];

  constructor(secretKey: string, options?: { maxBufferSize?: number | undefined }) {
    this.secretKey = secretKey;
    this.maxBufferSize = options?.maxBufferSize ?? 512 * 1024; // 512 KiB default ceiling
  }

  onEnvelope(listener: (envelope: Tier2IpcEnvelope) => void): void {
    this.envelopeListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }

  feed(chunk: Buffer): void {
    if (this.buffer.length + chunk.length > this.maxBufferSize) {
      const err = new Tier2IpcError("IPC_BUFFER_OVERFLOW", `IPC stream incoming buffer exceeded maximum allowed limit of ${this.maxBufferSize} bytes`);
      for (const listener of this.errorListeners) listener(err);
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      let decoded: { envelope: Tier2IpcEnvelope; remaining: Buffer } | null;
      try {
        decoded = decodeTier2IpcFrame(this.buffer);
      } catch (err: unknown) {
        this.buffer = Buffer.alloc(0);
        const error = err instanceof Error ? err : new Error(String(err));
        for (const listener of this.errorListeners) listener(error);
        return;
      }
      if (!decoded) break;
      this.buffer = Buffer.from(decoded.remaining);
      try {
        const verified = verifyTier2IpcEnvelope(decoded.envelope, this.secretKey);
        for (const listener of this.envelopeListeners) listener(verified);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        for (const listener of this.errorListeners) listener(error);
      }
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

