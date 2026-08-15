import crypto from "node:crypto";

export interface PasskeyRegistrationOptions {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ alg: number; type: "public-key" }>;
  authenticatorSelection?: {
    residentKey?: "preferred" | "required" | "discouraged";
    userVerification?: "preferred" | "required" | "discouraged";
  };
  timeout: number;
}

export interface PasskeyAuthenticationOptions {
  challenge: string;
  rpId: string;
  allowCredentials?: Array<{ id: string; type: "public-key" }>;
  userVerification?: "preferred" | "required" | "discouraged";
  timeout: number;
}

export function generatePasskeyRegistrationOptions(
  user: { id: string; email: string; name: string },
  rpId: string,
  rpName = "Vibress Platform",
): PasskeyRegistrationOptions {
  const challenge = crypto.randomBytes(32).toString("base64url");
  return {
    challenge,
    rp: { id: rpId, name: rpName },
    user: {
      id: Buffer.from(user.id).toString("base64url"),
      name: user.email,
      displayName: user.name,
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256
      { alg: -257, type: "public-key" }, // RS256
    ],
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    timeout: 60000,
  };
}

export function generatePasskeyAuthenticationOptions(
  rpId: string,
  allowCredentialIds: string[] = [],
): PasskeyAuthenticationOptions {
  const challenge = crypto.randomBytes(32).toString("base64url");
  return {
    challenge,
    rpId,
    allowCredentials: allowCredentialIds.map((id) => ({
      id,
      type: "public-key",
    })),
    userVerification: "preferred",
    timeout: 60000,
  };
}

export function verifyPasskeySignature(
  publicKeyPem: string,
  signatureBase64: string,
  authenticatorData: Buffer,
  clientDataHash: Buffer,
): boolean {
  try {
    const signedData = Buffer.concat([authenticatorData, clientDataHash]);
    const verify = crypto.createVerify("sha256");
    verify.update(signedData);
    return verify.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
