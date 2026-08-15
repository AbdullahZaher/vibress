import crypto from "node:crypto";

export interface TotpSetupResult {
  secret: string; // Base32 encoded secret
  uri: string; // otpauth:// URI
}

export interface BackupCodesResult {
  plainCodes: string[];
  hashedCodes: string[];
}

/**
 * Generates a random Base32 string for TOTP secret
 */
export function generateTotpSecret(length = 20): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const randomBytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < length; i++) {
    const byte = randomBytes[i] ?? 0;
    secret += alphabet[byte % 32];
  }
  return secret;
}

/**
 * Builds standard RFC 6238 otpauth:// URI for authenticator apps
 */
export function generateOtpAuthUri(
  secret: string,
  accountName: string,
  issuer = "Vibress",
): string {
  const encIssuer = encodeURIComponent(issuer);
  const encAccount = encodeURIComponent(accountName);
  return `otpauth://totp/${encIssuer}:${encAccount}?secret=${secret}&issuer=${encIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Computes 6-digit TOTP code for a given timestamp step (30s)
 */
function computeTotpCode(secret: string, timeStep: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(timeStep), 0);

  const hmac = crypto.createHmac("sha1", Buffer.from(secret));
  hmac.update(buffer);
  const digest = hmac.digest();

  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, "0");
}

/**
 * Verifies a 6-digit TOTP token against secret with ±1 time step tolerance (skew window)
 */
export function verifyTotpToken(
  secret: string,
  token: string,
  timestampMs = Date.now(),
): boolean {
  if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
    return false;
  }

  const currentStep = Math.floor(timestampMs / 1000 / 30);

  // Check current, -1 step (30s past), +1 step (30s future) for clock drift
  for (let delta = -1; delta <= 1; delta++) {
    const expected = computeTotpCode(secret, currentStep + delta);
    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return true;
    }
  }

  return false;
}

/**
 * Generates 10 single-use emergency backup recovery codes
 */
export function generateBackupCodes(count = 10): BackupCodesResult {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    const code = `${crypto.randomBytes(2).toString("hex")}-${crypto.randomBytes(2).toString("hex")}`;
    plainCodes.push(code);
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    hashedCodes.push(hash);
  }

  return { plainCodes, hashedCodes };
}
