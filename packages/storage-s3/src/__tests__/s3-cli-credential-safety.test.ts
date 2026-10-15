import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

describe("S3 CLI Credential Safety & Process Argument Isolation", () => {
  const ROOT_DIR = path.resolve(__dirname, "../../../../");
  const BACKUP_SCRIPT = path.join(ROOT_DIR, "scripts/s3-backup.mjs");
  const RESTORE_SCRIPT = path.join(ROOT_DIR, "scripts/s3-restore.mjs");

  it("should fail closed (exit 1) with [SECURITY ERROR] when --secret-key CLI argument is passed to backup", () => {
    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "test-bucket" --endpoint "http://127.0.0.1:9000" --access-key "dummy-key" --secret-key "super-secret-cli-arg"`,
        { encoding: "utf8", cwd: ROOT_DIR, stdio: "pipe" }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
      const output = (err.stdout || "") + (err.stderr || "");
      expect(output).toContain("[SECURITY ERROR]");
      expect(output).toContain("Passing secrets via --secret-key CLI argument is strictly forbidden");
      expect(output).not.toContain("super-secret-cli-arg"); // secret must never be printed
    }
    expect(failed).toBe(true);
  });

  it("should fail closed (exit 1) with [SECURITY ERROR] when --secret-key CLI argument is passed to restore", () => {
    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${RESTORE_SCRIPT}" --archive "/tmp/dummy.tar.gz" --bucket "test-bucket" --endpoint "http://127.0.0.1:9000" --access-key "dummy-key" --secret-key "super-secret-cli-arg"`,
        { encoding: "utf8", cwd: ROOT_DIR, stdio: "pipe" }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
      const output = (err.stdout || "") + (err.stderr || "");
      expect(output).toContain("[SECURITY ERROR]");
      expect(output).toContain("Passing secrets via --secret-key CLI argument is strictly forbidden");
      expect(output).not.toContain("super-secret-cli-arg"); // secret must never be printed
    }
    expect(failed).toBe(true);
  });

  it("should NOT output any security error/warning when credentials are provided purely via environment variables", () => {
    try {
      execSync(
        `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "test-bucket" --endpoint "http://127.0.0.1:9000"`,
        {
          encoding: "utf8",
          cwd: ROOT_DIR,
          stdio: "pipe",
          env: {
            ...process.env,
            S3_ACCESS_KEY_ID: "minioadmin",
            S3_SECRET_ACCESS_KEY: "minioadmin",
          },
        }
      );
    } catch (err: any) {
      const output = (err.stdout || "") + (err.stderr || "");
      expect(output).not.toContain("[SECURITY ERROR]");
      expect(output).not.toContain("[SECURITY WARNING]");
    }
  });

  it("should redact secret values in error messages", () => {
    try {
      execSync(
        `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "test-bucket" --endpoint "http://127.0.0.1:9000"`,
        {
          encoding: "utf8",
          cwd: ROOT_DIR,
          stdio: "pipe",
          env: {
            ...process.env,
            S3_ACCESS_KEY_ID: "minioadmin",
            S3_SECRET_ACCESS_KEY: "very-secret-token-value-12345",
          },
        }
      );
    } catch (err: any) {
      const output = (err.stdout || "") + (err.stderr || "");
      expect(output).not.toContain("very-secret-token-value-12345");
      if (output.includes("Secret Key:")) {
        expect(output).toContain("ver...345");
      }
    }
  });
});
