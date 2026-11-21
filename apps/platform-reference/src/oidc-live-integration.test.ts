import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  createServer,
  type Server,
} from "node:http";
import {
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import {
  deriveOidcPrincipalId,
  InvalidOidcTokenError,
  OidcPrincipalVerifier,
  type OidcJwk,
  type OidcJwks,
} from "./oidc-principal-verifier";
import { asApplicationId } from "@vibress/platform-kernel";

const ISSUER = "http://127.0.0.1:19999";
const AUDIENCE = "vibress-test-client";
const APPLICATION_ID = asApplicationId("crm-app");
const INSTALLATION_ID = "install-a";

interface ProviderState {
  server: Server;
  jwks: OidcJwks;
  sign: (claims: Record<string, unknown>, kid: string, key?: KeyObject) => string;
}

function publicJwk(key: KeyObject, kid: string): OidcJwk {
  const exported = createPublicKey(key).export({ format: "jwk" }) as JsonWebKey;
  return { kty: exported.kty, kid, alg: "RS256", use: "sig", n: exported.n, e: exported.e };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signToken(
  claims: Record<string, unknown>,
  kid: string,
  privateKey: KeyObject,
  headerOverride: Record<string, unknown> = {},
): string {
  const header = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid, ...headerOverride }),
  );
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

let provider: ProviderState;

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks: OidcJwks = { keys: [publicJwk(privateKey, "key-1")] };
  const server = createServer((request, response) => {
    if (request.url === "/.well-known/openid-configuration") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer: ISSUER,
          jwks_uri: `${ISSUER}/jwks`,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
      return;
    }
    if (request.url === "/jwks") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(jwks));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(19999, "127.0.0.1", resolve));
  provider = {
    server,
    jwks,
    sign: (claims, kid, key = privateKey) => signToken(claims, kid, key),
  };
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    provider.server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function discover() {
  const discoveryResponse = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  const discovery = (await discoveryResponse.json()) as {
    issuer: string;
    jwks_uri: string;
  };
  const jwksResponse = await fetch(discovery.jwks_uri);
  const jwks = (await jwksResponse.json()) as OidcJwks;
  return { discovery, jwks };
}

function verifier(jwks: OidcJwks) {
  return new OidcPrincipalVerifier(
    {
      issuer: ISSUER,
      audience: AUDIENCE,
      applicationId: APPLICATION_ID,
      installationId: INSTALLATION_ID,
      principalKind: "end_user",
    },
    jwks,
  );
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "user-1",
    iat: now,
    exp: now + 3600,
    vib_application_id: APPLICATION_ID,
    vib_installation_id: INSTALLATION_ID,
    ...overrides,
  };
}

function expectCode(token: string, code: string, jwks = provider.jwks) {
  let captured: unknown;
  try {
    verifier(jwks).verify(token);
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(InvalidOidcTokenError);
  expect((captured as InvalidOidcTokenError).code).toBe(code);
}

describe("M02-E01 live disposable OIDC/JWKS integration", () => {
  it("discovers configuration and JWKS over real HTTP", async () => {
    const { discovery, jwks } = await discover();
    expect(discovery.issuer).toBe(ISSUER);
    expect(jwks.keys.length).toBeGreaterThan(0);
  });

  it("verifies a signed token through the real provider contract", async () => {
    const { jwks } = await discover();
    const principal = verifier(jwks).verify(
      provider.sign(claims(), "key-1"),
    );
    expect(principal.id).toBe(deriveOidcPrincipalId(ISSUER, "user-1"));
    expect(principal.applicationId).toBe(APPLICATION_ID);
    expect(principal.tenantIds).toEqual([]);
  });

  it("rejects wrong issuer, audience, bindings, expiry and not-before", async () => {
    const { jwks } = await discover();
    expectCode(provider.sign(claims({ iss: "https://evil.example" }), "key-1"), "wrong_issuer", jwks);
    expectCode(provider.sign(claims({ aud: "other" }), "key-1"), "wrong_audience", jwks);
    expectCode(
      provider.sign(claims({ vib_application_id: "other-app" }), "key-1"),
      "application_binding_mismatch",
      jwks,
    );
    expectCode(
      provider.sign(claims({ vib_installation_id: "install-b" }), "key-1"),
      "installation_binding_mismatch",
      jwks,
    );
    const now = Math.floor(Date.now() / 1000);
    expectCode(provider.sign(claims({ exp: now - 100 }), "key-1"), "token_expired", jwks);
    expectCode(provider.sign(claims({ nbf: now + 600 }), "key-1"), "token_not_yet_valid", jwks);
  });

  it("rejects unknown keys, unsupported algorithms and forged signatures", async () => {
    const { jwks } = await discover();
    expectCode(provider.sign(claims(), "key-999"), "unknown_key", jwks);
    const es256Only = new OidcPrincipalVerifier(
      {
        issuer: ISSUER,
        audience: AUDIENCE,
        applicationId: APPLICATION_ID,
        installationId: INSTALLATION_ID,
        algorithms: ["ES256"],
      },
      jwks,
    );
    let algorithmError: unknown;
    try {
      es256Only.verify(provider.sign(claims(), "key-1"));
    } catch (error) {
      algorithmError = error;
    }
    expect((algorithmError as InvalidOidcTokenError).code).toBe(
      "unsupported_algorithm",
    );
    const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expectCode(provider.sign(claims(), "key-1", otherKey), "invalid_signature", jwks);
  });

  it("enforces key rotation by refusing tokens signed with a retired key", async () => {
    const { jwks } = await discover();
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const rotatedJwks: OidcJwks = { keys: [publicJwk(rotated, "key-2")] };
    expectCode(provider.sign(claims(), "key-1"), "unknown_key", rotatedJwks);
    const principal = verifier(rotatedJwks).verify(provider.sign(claims(), "key-2", rotated));
    expect(principal.applicationId).toBe(APPLICATION_ID);
  });

  it("exercises a real HTTP application path with fail-closed behavior", async () => {
    const { jwks } = await discover();
    const app = createServer((request, response) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      try {
        if (!token) throw new Error("missing token");
        const principal = verifier(jwks).verify(token);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ principal: principal.id }));
      } catch {
        response.writeHead(401);
        response.end("UNAUTHENTICATED");
      }
    });
    await new Promise<void>((resolve) => app.listen(19998, "127.0.0.1", resolve));
    try {
      const ok = await fetch("http://127.0.0.1:19998/whoami", {
        headers: { authorization: `Bearer ${provider.sign(claims(), "key-1")}` },
      });
      expect(ok.status).toBe(200);
      const denied = await fetch("http://127.0.0.1:19998/whoami", {
        headers: { authorization: "Bearer forged" },
      });
      expect(denied.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  });
});
