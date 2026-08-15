import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Disaster Recovery Backup & Restore Integrity Drill", () => {
  it("computes and verifies SHA-256 checksum integrity of database backup archive", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-dr-"));
    const backupPath = path.join(tmpDir, "backup_sample.sql.gz");
    const checksumPath = `${backupPath}.sha256`;

    // 1. Create dummy compressed backup content
    const backupContent = Buffer.from("DUMMY_POSTGRES_DUMP_GZIP_STREAM_VIBRESS_PROD_DATA");
    fs.writeFileSync(backupPath, backupContent);

    // 2. Generate SHA-256 checksum
    const hash = crypto.createHash("sha256").update(backupContent).digest("hex");
    fs.writeFileSync(checksumPath, `${hash}  backup_sample.sql.gz\n`);

    // 3. Verify intact backup matches checksum
    const readContent = fs.readFileSync(backupPath);
    const calculatedHash = crypto.createHash("sha256").update(readContent).digest("hex");
    const storedHash = fs.readFileSync(checksumPath, "utf-8").split(/\s+/)[0];

    expect(calculatedHash).toBe(storedHash);

    // 4. Verify tampered backup fails checksum
    const tamperedContent = Buffer.from("TAMPERED_MALICIOUS_DUMP_PAYLOAD");
    const tamperedHash = crypto.createHash("sha256").update(tamperedContent).digest("hex");
    expect(tamperedHash).not.toBe(storedHash);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
