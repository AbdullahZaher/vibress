// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  asApplicationId, asInstallationId, asTenantId,
  defineAction, defineApplication, InMemoryApplicationRegistry,
} from "@vibress/platform-kernel";
import { PolicyEngine, RouteExecutor, resolveVerifiedScope, type ScopeResolver } from "@vibress/tenancy";
import {
  IdentityDeniedError, ProductionOidcAuthenticationAdapter,
  type ProductionOidcConfig,
} from "./production-oidc-authentication-adapter";

const NOW = 1_800_000_000;
const issuer = "https://issuer.example.test/tenant";
const app = "platform-reference", installation = "reference-installation";
const audience = "api://vibress", client = "test-registered-client";
const first = generateKeyPairSync("rsa", { modulusLength: 2048 });
const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
function jwk(pair: typeof first, kid: string) {
  return { ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
}
function token(
  changes: Record<string, unknown> = {},
  head: Record<string, unknown> = {},
  pair = first,
) {
  const b = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const jwt = b({ typ: "at+jwt", alg: "RS256", kid: "one", ...head }) + "." +
    b({ iss: issuer, aud: audience, sub: "user-1", iat: NOW - 2,
      nbf: NOW - 1, exp: NOW + 300, jti: "fixture-token-1", client_id: client,
      vib_application_id: app, vib_installation_id: installation, ...changes });
  return jwt + "." + sign("sha256", Buffer.from(jwt), pair.privateKey).toString("base64url");
}
function fixture(opts: {
  active?: boolean; revoked?: boolean; revocationDown?: boolean;
  membershipDown?: boolean; now?: () => number;
  load?: () => Promise<{ keys: ReturnType<typeof jwk>[] }>;
} = {}) {
  let loads = 0;
  const membership: ScopeResolver = {
    async resolve(principalId, applicationId, tenantId) {
      if (opts.membershipDown) throw new Error("db-outage");
      if (tenantId !== asTenantId("tenant-a")) return null;
      return { principalId, applicationId, tenantId, active: opts.active ?? true,
        roles: ["admin"], permissions: ["customers.read"] };
    },
  };
  const config: ProductionOidcConfig = {
    issuer, audience, clientId: client, applicationId: app, installationId: installation,
    now: opts.now ?? (() => NOW),
    jwksSource: { async load() {
      loads++;
      return opts.load ? opts.load() : { keys: [jwk(first, "one")] };
    } },
    revocation: { async isActive() {
      if (opts.revocationDown) throw new Error("revocation-down");
      return opts.revoked !== true;
    } },
    membership,
  };
  return { adapter: new ProductionOidcAuthenticationAdapter(config), membership, loads: () => loads };
}
function req(t: string, tenantId = "tenant-a") {
  return { token: t, tenantId, applicationId: app, installationId: installation };
}
async function deny(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("W1-T07 production OIDC candidate", () => {
  it("hydrates ONLY server-confirmed tenant, then permits RouteExecutor scope check", async () => {
    const { adapter, membership } = fixture();
    const principal = await adapter.authenticate(req(token({
      tenantIds: ["tenant-b"], roles: ["root"], permissions: ["*"],
    })));
    expect(principal.tenantIds).toEqual(["tenant-a"]);
    expect(principal.roles).toEqual([]);
    expect(principal.permissions).toEqual(["customers.read"]);
    const scope = await resolveVerifiedScope(membership, {
      principal, tenantId: asTenantId("tenant-a"),
      applicationId: asApplicationId(app), policyVersion: "p1",
    });
    expect(scope.authorization.permissions).toEqual(["customers.read"]);
  });
  it("authorizes only server-side membership grants and rechecks revocation at action time", async () => {
    const state = { active: true };
    const { adapter, membership } = fixture(state);
    const principal = await adapter.authenticate(req(token({
      tenantIds: ["tenant-b"], roles: ["root"],
      permissions: ["*"],
    })));
    expect(principal.roles).toEqual([]);
    expect(principal.permissions).toEqual(["customers.read"]);

    const application = defineApplication({
      id: asApplicationId(app),
      name: "OIDC authorization contract probe",
      version: "1.0.0",
      actions: {
        read: defineAction({
          name: "read", permission: "customers.read",
          input: () => null,
          handler: async ({ context }) => ({ tenant: context.tenantId }),
        }),
        write: defineAction({
          name: "write", permission: "customers.write",
          input: () => null,
          handler: async () => ({ unsafe: true }),
        }),
      },
      http: [
        { method: "GET", path: "/records", action: "read", auth: "member" },
        { method: "POST", path: "/records", action: "write", auth: "member" },
      ],
    });
    const executor = new RouteExecutor({
      registry: new InMemoryApplicationRegistry([application]),
      policy: new PolicyEngine([{ id: "allow-probe", action: "*", effect: "allow" }]),
      scopeResolver: membership,
      policyVersion: "server-membership-v1",
      unitOfWork: {
        async run(scope, work) {
          return work({
            scope,
            query: async () => ({ rows: [], rowCount: 0 }),
            markRollbackOnly: () => {},
          });
        },
      },
    });
    const base = {
      principal,
      tenantId: asTenantId("tenant-a"),
      installationId: asInstallationId(installation),
      requestId: "oidc-policy-probe",
      path: "/records",
    };
    const allowed = await executor.execute({ ...base, method: "GET" });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ tenant: asTenantId("tenant-a") });
    const forgedWildcard = await executor.execute({ ...base, method: "POST" });
    expect(forgedWildcard.status).toBe(403);
    state.active = false;
    const revokedAfterAuthentication = await executor.execute({ ...base, method: "GET" });
    expect(revokedAfterAuthentication.status).toBe(403);
    expect(revokedAfterAuthentication.body).toMatchObject({
      error: { code: "scope_denied" },
    });
  });
  it("rejects unknown tenants and revoked memberships", async () => {
    await deny(fixture().adapter.authenticate(req(token(), "tenant-b")), "tenant_denied");
    await deny(fixture({ active: false }).adapter.authenticate(req(token())), "tenant_denied");
  });
  it("rejects token revocation and fails closed on revocation outage", async () => {
    await deny(fixture({ revoked: true }).adapter.authenticate(req(token())), "revoked_token");
    await deny(fixture({ revocationDown: true }).adapter.authenticate(req(token())), "revocation_unavailable");
  });
  it("fails closed on membership outage and mismatched context", async () => {
    await deny(fixture({ membershipDown: true }).adapter.authenticate(req(token())), "membership_unavailable");
    await deny(fixture().adapter.authenticate({ ...req(token()), applicationId: "foreign-app" }), "wrong_context");
    await deny(fixture().adapter.authenticate({ ...req(token()), installationId: "foreign-install" }), "wrong_context");
  });
  it("rejects ID tokens and dangerous JOSE headers", async () => {
    for (const head of [{ typ: "JWT" }, { typ: "id+jwt" }, { crit: ["b64"] },
      { jku: "https://evil.invalid/key" }, { x5u: "https://evil.invalid/x" },
      { jwk: {} }, { b64: false }, { cty: "JWT" }]) {
      await deny(fixture().adapter.authenticate(req(token({}, head))), "invalid_token_profile");
    }
  });
  it("rejects missing, empty, malformed and ambiguous JWT IDs", async () => {
    for (const changes of [{ jti: "" }, { jti: null }, { jti: 123 },
      { jti: "x".repeat(257) }, { jti: "bad\\nidentifier" }]) {
      await deny(fixture().adapter.authenticate(req(token(changes))), "invalid_token_profile");
    }
    const raw = token();
    const [h, p] = raw.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as Record<string, unknown>;
    delete payload.jti;
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = h + "." + encoded;
    const missingJti = signingInput + "." +
      sign("sha256", Buffer.from(signingInput), first.privateKey).toString("base64url");
    await deny(fixture().adapter.authenticate(req(missingJti)), "invalid_token_profile");
  });
  it("rejects client confusion, multiple audiences, excessive lifetime", async () => {
    await deny(fixture().adapter.authenticate(req(token({ client_id: "intruder" }))), "wrong_client");
    await deny(fixture().adapter.authenticate(req(token({ azp: "intruder" }))), "wrong_client");
    await deny(fixture().adapter.authenticate(req(token({ aud: [audience, "second"] }))), "invalid_token_profile");
    await deny(fixture().adapter.authenticate(req(token({ exp: NOW + 5000 }))), "token_lifetime_exceeded");
  });
  it("rejects signature, kid, alg, issuer, audience, time, app and install changes", async () => {
    const tokens = [
      token({}, {}, second), token({}, { kid: "unknown" }), token({}, { kid: "" }),
      token({}, { alg: "none" }), token({ iss: "https://foreign.invalid" }),
      token({ aud: "other-api" }), token({ exp: NOW - 100 }),
      token({ nbf: NOW + 200 }), token({ iat: NOW + 200 }),
      token({ vib_application_id: "foreign-app" }),
      token({ vib_installation_id: "foreign-install" }),
    ];
    for (const t of tokens) await expect(fixture().adapter.authenticate(req(t))).rejects.toThrow();
  });
  it("fails closed on expired JWKS snapshot and provider outage", async () => {
    let now = NOW, down = false;
    const { adapter, loads } = fixture({
      now: () => now, load: async () => {
        if (down) throw new Error("idp-offline");
        return { keys: [jwk(first, "one")] };
      },
    });
    await adapter.authenticate(req(token()));
    now += 310;
    down = true;
    await deny(adapter.authenticate(req(token({ exp: NOW + 600 }))), "jwks_unavailable");
    expect(loads()).toBe(2);
  });
  it("rate-limits unknown-kid refresh, then accepts rotated key", async () => {
    let now = NOW, rotated = false;
    const { adapter, loads } = fixture({
      now: () => now,
      load: async () => ({ keys: [rotated ? jwk(second, "two") : jwk(first, "one")] }),
    });
    await adapter.authenticate(req(token()));
    rotated = true;
    const next = token({}, { kid: "two" }, second);
    await expect(adapter.authenticate(req(next))).rejects.toThrow();
    expect(loads()).toBe(1);
    now += 31;
    await adapter.authenticate(req(next));
    expect(loads()).toBe(2);
  });
  it("never embeds raw bearer token in returned error", async () => {
    const t = token({ client_id: "bad" });
    try { await fixture().adapter.authenticate(req(t)); }
    catch (e) {
      expect(e).toBeInstanceOf(IdentityDeniedError);
      expect(String(e)).not.toContain(t);
      return;
    }
    throw new Error("expected failure");
  });
});
