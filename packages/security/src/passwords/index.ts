import argon2 from "argon2";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

export function validatePasswordPolicy(
  password: string,
): PasswordValidationResult {
  if (typeof password !== "string") {
    return { valid: false, reason: "Password must be a string" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at most ${MAX_PASSWORD_LENGTH} characters long`,
    };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  const validation = validatePasswordPolicy(password);
  if (!validation.valid) {
    throw new Error(validation.reason || "Invalid password policy");
  }
  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  if (
    !hash ||
    typeof password !== "string" ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Pre-computed dummy hash to prevent timing attacks when user/email doesn't exist
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$dummyhashforprotection$dummyhashforprotection";

export async function dummyVerifyPassword(): Promise<boolean> {
  try {
    await argon2.verify(DUMMY_HASH, "dummy_password");
  } catch {
    // Ignore error
  }
  return false;
}
