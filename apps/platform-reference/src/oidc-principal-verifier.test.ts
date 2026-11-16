// @vitest-environment node
import {
  createHmac,
  generateKeyPairSync,
  sign,
  type KeyObject,
  type webcrypto,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InvalidOidcJwkSetError,
  InvalidOidcTokenError,
  OidcPrincipalVerifier,
  deriveOidcPrincipalId,
  type OidcJwks,
  type OidcTokenViolationCode,
} from "./oidc-principal-verifier";

const ISSUER = "https://idp.example.test/tenant";
const AUDIENCE = "vibress-platform";
const APPLICATION = "platform-reference";
const INSTALLATION = "reference-installation";
const NOW = 1_760_000_000;

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });

type TestJwk = webcrypto.JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

function publicJwk(
  publicKey: KeyObject,
  kid: string,
  alg: "RS256" | "ES256",
): TestJwk {
  const jwk = publicKey.export({ format: "jwk" }) as TestJwk;
  return { ...jwk, kid, alg, use: "sig" };
}

const rsaJwk = publicJwk(rsa.publicKey, "rsa-1", "RS256");
const ecJwk = publicJwk(ec.publicKey, "ec-1", "ES256");

function jwks(...keys: TestJwk[]): OidcJwks {
  return { keys };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: KeyObject,
  algorithm: "RS256" | "ES256",
): string {
  const input = `${encode(header)}.${encode(claims)}`;
  const signature =
    algorithm === "ES256"
      ? sign("sha256", Buffer.from(input, "utf8"), {
          key: privateKey,
          dsaEncoding: "ieee-p1363",
        })
      : sign("sha256", Buffer.from(input, "utf8"), privateKey);
  return `${input}.${signature.toString("base64url")}`;
}

function baseClaims(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "auth0|user-a",
    exp: NOW + 300,
    iat: NOW - 5,
    nbf: NOW - 1,
    vib_application_id: APPLICATION,
    vib_installation_id: INSTALLATION,
    ...overrides,
  };
}

function verifier(
  overrides: {
    jwks?: OidcJwks;
    issuer?: string;
    algorithms?: readonly ("RS256" | "ES256")[];
    now?: number;
  } = {},
): OidcPrincipalVerifier {
  return new OidcPrincipalVerifier(
    {
      issuer: overrides.issuer ?? ISSUER,
      audience: AUDIENCE,
      applicationId: APPLICATION,
      installationId: INSTALLATION,
      now: () => overrides.now ?? NOW,
      ...(overrides.algorithms ? { algorithms: overrides.algorithms } : {}),
    },
    overrides.jwks ?? jwks(rsaJwk, ecJwk),
  );
}

function rs256(
  claims: Record<string, unknown> = baseClaims(),
  kid = "rsa-1",
): string {
  return signJwt({ alg: "RS256", typ: "JWT", kid }, claims, rsa.privateKey, "RS256");
}

function expectViolation(token: string, code: OidcTokenViolationCode): void {
  expectViolationFor(verifier(), token, code);
}

function expectViolationFor(
  instance: OidcPrincipalVerifier,
  token: string,
  code: OidcTokenViolationCode,
): void {
  const error = (() => {
    try {
      instance.verify(token);
      return null;
    } catch (caught) {
      return caught;
    }
  })();
  expect(error).toBeInstanceOf(InvalidOidcTokenError);
  expect((error as InvalidOidcTokenError).code).toBe(code);
}

function without(
  claims: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...claims };
  delete copy[key];
  return copy;
}

describe("OIDC principal verifier — acceptance", () => {
  it("verifies an RS256 token and derives the principal from sub", () => {
    const principal = verifier().verify(rs256());
    expect(principal.id).toBe(deriveOidcPrincipalId(ISSUER, "auth0|user-a"));
    expect(principal.id).toMatch(/^p_[0-9a-f]{32}$/);
    expect(principal.kind).toBe("end_user");
    expect(principal.applicationId).toBe(APPLICATION);
    expect(principal.tenantIds).toEqual([]);
    expect(principal.roles).toEqual([]);
    expect(principal.permissions).toEqual([]);
  });

  it("verifies an ES256 token with JOSE raw signatures", () => {
    const token = signJwt(
      { alg: "ES256", typ: "JWT", kid: "ec-1" },
      baseClaims(),
      ec.privateKey,
      "ES256",
    );
    expect(verifier().verify(token).id).toBe(
      deriveOidcPrincipalId(ISSUER, "auth0|user-a"),
    );
  });

  it("accepts an audience array containing the configured audience", () => {
    const token = rs256(baseClaims({ aud: ["other", AUDIENCE] }));
    expect(verifier().verify(token).id).toBeTruthy();
  });

  it("does not trust tenant, role or permission claims", () => {
    const token = rs256(
      baseClaims({
        tenantIds: ["tenant-b"],
        roles: ["admin"],
        permissions: ["*"],
        kind: "operator",
        applicationId: "other-app",
      }),
    );
    const principal = verifier().verify(token);
    expect(principal.tenantIds).toEqual([]);
    expect(principal.roles).toEqual([]);
    expect(principal.permissions).toEqual([]);
    expect(principal.kind).toBe("end_user");
    expect(principal.applicationId).toBe(APPLICATION);
  });

  it("derives different principal ids for the same sub under different issuers", () => {
    expect(deriveOidcPrincipalId(ISSUER, "sub")).not.toBe(
      deriveOidcPrincipalId("https://other.example.test", "sub"),
    );
  });
});

describe("OIDC principal verifier — deny matrix", () => {
  it("rejects a malformed token", () => {
    expectViolation("not-a-jwt", "malformed_token");
    expectViolation("a.b", "malformed_token");
    expectViolation(`${encode({ alg: "RS256" })}.${encode({})}.`, "malformed_token");
  });

  it("rejects alg none and HMAC algorithms", () => {
    const unsigned = `${encode({ alg: "none", kid: "rsa-1" })}.${encode(baseClaims())}.AAAA`;
    expectViolation(unsigned, "unsupported_algorithm");

    const input = `${encode({ alg: "HS256", kid: "rsa-1" })}.${encode(baseClaims())}`;
    const signature = createHmac("sha256", "public-material")
      .update(input)
      .digest("base64url");
    expectViolation(`${input}.${signature}`, "unsupported_algorithm");
  });

  it("rejects an unknown kid, an ambiguous kid and a key-type mismatch", () => {
    expectViolation(rs256(baseClaims(), "missing"), "unknown_key");

    const duplicate = new OidcPrincipalVerifier(
      {
        issuer: ISSUER,
        audience: AUDIENCE,
        applicationId: APPLICATION,
        installationId: INSTALLATION,
        now: () => NOW,
      },
      jwks(rsaJwk, publicJwk(rsa.publicKey, "rsa-1", "RS256")),
    );
    expectViolationFor(duplicate, rs256(), "ambiguous_key");

    expectViolation(
      signJwt(
        { alg: "ES256", kid: "rsa-1" },
        baseClaims(),
        ec.privateKey,
        "ES256",
      ),
      "unknown_key",
    );
  });

  it("rejects a tampered payload and a tampered signature", () => {
    const token = rs256();
    const [header, , signature] = token.split(".") as [string, string, string];
    const tampered = `${header}.${encode(baseClaims({ sub: "auth0|attacker" }))}.${signature}`;
    expectViolation(tampered, "invalid_signature");

    const flipped = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    expectViolation(flipped, "invalid_signature");
  });

  it("rejects a wrong issuer", () => {
    expectViolation(
      rs256(baseClaims({ iss: "https://evil.example.test" })),
      "wrong_issuer",
    );
  });

  it("rejects a wrong or missing audience", () => {
    expectViolation(rs256(baseClaims({ aud: "other-service" })), "wrong_audience");
    expectViolation(rs256(baseClaims({ aud: [] })), "wrong_audience");
    expectViolation(rs256(without(baseClaims(), "aud")), "wrong_audience");
  });

  it("rejects expired, not-yet-valid and future-issued tokens", () => {
    expectViolation(rs256(baseClaims({ exp: NOW - 31 })), "token_expired");
    expectViolation(rs256(baseClaims({ nbf: NOW + 31 })), "token_not_yet_valid");
    expectViolation(rs256(baseClaims({ iat: NOW + 31 })), "issued_in_future");
  });

  it("rejects non-numeric or missing exp/iat", () => {
    expectViolation(rs256(baseClaims({ exp: "soon" })), "malformed_token");
    expectViolation(rs256(without(baseClaims(), "iat")), "malformed_token");
  });

  it("honours the configured clock skew", () => {
    const skewed = new OidcPrincipalVerifier(
      {
        issuer: ISSUER,
        audience: AUDIENCE,
        applicationId: APPLICATION,
        installationId: INSTALLATION,
        clockSkewSeconds: 120,
        now: () => NOW,
      },
      jwks(rsaJwk),
    );
    expect(() => skewed.verify(rs256(baseClaims({ exp: NOW - 60 })))).not.toThrow();
    expect(() => skewed.verify(rs256(baseClaims({ exp: NOW - 121 })))).toThrow(
      expect.objectContaining({ code: "token_expired" }),
    );
  });

  it("rejects a missing or empty subject", () => {
    expectViolation(rs256(baseClaims({ sub: "" })), "missing_subject");
    expectViolation(rs256(without(baseClaims(), "sub")), "missing_subject");
  });

  it("rejects a missing or different application binding", () => {
    expectViolation(
      rs256(without(baseClaims(), "vib_application_id")),
      "application_binding_mismatch",
    );
    expectViolation(
      rs256(baseClaims({ vib_application_id: "other-app" })),
      "application_binding_mismatch",
    );
  });

  it("rejects a missing or different installation binding", () => {
    expectViolation(
      rs256(without(baseClaims(), "vib_installation_id")),
      "installation_binding_mismatch",
    );
    expectViolation(
      rs256(baseClaims({ vib_installation_id: "other-installation" })),
      "installation_binding_mismatch",
    );
  });

  it("refuses keys declaring an unsupported algorithm", () => {
    expect(() =>
      verifier({
        jwks: jwks({ ...rsaJwk, alg: "PS256" } as unknown as TestJwk),
      }),
    ).toThrow(InvalidOidcJwkSetError);
  });
});

describe("OIDC principal verifier — configuration", () => {
  it("refuses an empty JWKS and non-RSA/EC key material", () => {
    expect(() => verifier({ jwks: { keys: [] } })).toThrow(InvalidOidcJwkSetError);
    expect(() =>
      verifier({
        jwks: jwks({ kty: "RSA", kid: "rsa-incomplete" } as unknown as TestJwk),
      }),
    ).toThrow(InvalidOidcJwkSetError);
    expect(() =>
      verifier({
        jwks: jwks({ kty: "oct", kid: "hmac", alg: "HS256" } as unknown as TestJwk),
      }),
    ).toThrow(InvalidOidcJwkSetError);
    expect(() =>
      verifier({
        jwks: jwks({
          kty: "EC",
          kid: "ec-384",
          crv: "P-384",
          x: "x",
          y: "y",
        } as unknown as TestJwk),
      }),
    ).toThrow(InvalidOidcJwkSetError);
  });

  it("refuses an empty algorithm allowlist", () => {
    expect(() => verifier({ algorithms: [] })).toThrow(InvalidOidcJwkSetError);
  });

  it("uses the configured clock function, not the wall clock", () => {
    const token = rs256(baseClaims({ exp: NOW + 10 }));
    const future = new OidcPrincipalVerifier(
      {
        issuer: ISSUER,
        audience: AUDIENCE,
        applicationId: APPLICATION,
        installationId: INSTALLATION,
        now: () => NOW + 1_000,
      },
      jwks(rsaJwk),
    );
    expect(() => future.verify(token)).toThrow(
      new RegExp("Invalid OIDC token"),
    );
    const error = (() => {
      try {
        future.verify(token);
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect((error as InvalidOidcTokenError).code).toBe("token_expired");
  });
});
