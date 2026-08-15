import crypto from "node:crypto";

export interface WebFingerInput {
  handle: string; // e.g. "editor@publication.com"
  domain: string; // e.g. "publication.com"
  actorUrl: string; // e.g. "https://publication.com/users/editor"
}

export function generateWebFingerResponse(input: WebFingerInput): Record<string, unknown> {
  const resource = `acct:${input.handle.includes("@") ? input.handle : `${input.handle}@${input.domain}`}`;

  return {
    subject: resource,
    aliases: [input.actorUrl],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: input.actorUrl,
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: input.actorUrl,
      },
    ],
  };
}

export interface ActivityPubActorInput {
  id: string; // Actor URI
  username: string;
  name: string;
  summary?: string | undefined;
  iconUrl?: string | undefined;
  publicKeyPem: string;
}

export function generateActivityPubActor(input: ActivityPubActorInput): Record<string, unknown> {
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: input.id,
    type: "Person",
    preferredUsername: input.username,
    name: input.name,
    summary: input.summary,
    inbox: `${input.id}/inbox`,
    outbox: `${input.id}/outbox`,
    icon: input.iconUrl
      ? {
          type: "Image",
          mediaType: "image/jpeg",
          url: input.iconUrl,
        }
      : undefined,
    publicKey: {
      id: `${input.id}#main-key`,
      owner: input.id,
      publicKeyPem: input.publicKeyPem,
    },
  };
}

export interface ActivityPubActivityInput {
  id: string;
  actorId: string;
  type: "Create" | "Update" | "Delete" | "Follow" | "Accept";
  object: Record<string, unknown> | string;
  to?: string[];
  cc?: string[];
}

export function buildActivityPubActivity(input: ActivityPubActivityInput): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: input.id,
    type: input.type,
    actor: input.actorId,
    published: new Date().toISOString(),
    to: input.to || ["https://www.w3.org/ns/activitystreams#Public"],
    cc: input.cc || [],
    object: input.object,
  };
}

export function buildActivityPubDelete(input: {
  id: string;
  actorId: string;
  objectId: string;
}): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: input.id,
    type: "Delete",
    actor: input.actorId,
    published: new Date().toISOString(),
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: {
      id: input.objectId,
      type: "Tombstone",
      deleted: new Date().toISOString(),
    },
  };
}

export function isDomainBlocked(actorUrl: string, blockedDomains: string[]): boolean {
  try {
    const parsed = new URL(actorUrl);
    const hostname = parsed.hostname.toLowerCase();
    return blockedDomains.some((d) => {
      const b = d.toLowerCase().trim();
      return hostname === b || hostname.endsWith(`.${b}`);
    });
  } catch {
    return true; // invalid actor URL is blocked by default
  }
}

export function validateActivityPubPayloadSize(
  payload: unknown,
  maxSizeBytes = 65536, // 64 KB limit
): { valid: boolean; sizeBytes: number; error?: string } {
  try {
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");
    if (sizeBytes > maxSizeBytes) {
      return {
        valid: false,
        sizeBytes,
        error: `Payload size (${sizeBytes} bytes) exceeds maximum limit of ${maxSizeBytes} bytes`,
      };
    }
    return { valid: true, sizeBytes };
  } catch {
    return { valid: false, sizeBytes: 0, error: "Invalid payload format" };
  }
}

export function generateHttpSignatureHeader(
  keyId: string,
  privateKeyPem: string,
  headers: Record<string, string>,
): string {
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
  const signString = headerKeys.map((k) => `${k}: ${headers[k]}`).join("\n");

  const sign = crypto.createSign("sha256");
  sign.update(signString);
  const signature = sign.sign(privateKeyPem, "base64");

  return `keyId="${keyId}",algorithm="rsa-sha256",headers="${headerKeys.join(" ")}",signature="${signature}"`;
}
