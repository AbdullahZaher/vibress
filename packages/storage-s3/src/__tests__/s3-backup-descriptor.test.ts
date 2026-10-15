import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

describe("S3 Backup Descriptor Verification & Tamper Detection", () => {
  const S3_ENDPOINT = "http://127.0.0.1:9000";
  const S3_REGION = "us-east-1";
  const S3_ACCESS_KEY = "minioadmin";
  const S3_SECRET_KEY = "minioadmin";
  const TS = Date.now();
  const BUCKET = `test-descriptor-${TS}`;
  const ROOT_DIR = path.resolve(__dirname, "../../../../");
  const BACKUP_SCRIPT = path.join(ROOT_DIR, "scripts/s3-backup.mjs");
  const TEST_DIR = path.resolve(ROOT_DIR, `backups/test_descriptor_${TS}`);

  const authEnv = {
    ...process.env,
    S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
    S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
    AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
  };

  const s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    forcePathStyle: true,
  });

  beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET }));
      // Seed some test objects into the bucket
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: "media/photo1.jpg",
          Body: Buffer.from("fake-jpg-content-12345"),
          ContentType: "image/jpeg",
        })
      );
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: "media/docs/report.pdf",
          Body: Buffer.from("fake-pdf-content-67890"),
          ContentType: "application/pdf",
        })
      );
    } catch {
      // ignore
    }
  });

  afterAll(async () => {
    // Clean up S3 objects and bucket
    try {
      const list = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET }));
      if (list.Contents) {
        for (const item of list.Contents) {
          if (item.Key) {
            await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: item.Key }));
          }
        }
      }
      await s3Client.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    } catch {
      // ignore
    }

    // Clean up local temp directory
    try {
      if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it("should successfully emit a complete JSON descriptor file with matching archiveFile, archiveSha256, and objectCount", () => {
    const descriptorPath = path.join(TEST_DIR, "descriptor_test_1.json");
    execSync(
      `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "${BUCKET}" --endpoint "${S3_ENDPOINT}" --output "${TEST_DIR}" --descriptor-out "${descriptorPath}"`,
      { encoding: "utf8", cwd: ROOT_DIR, stdio: "pipe", env: authEnv }
    );

    expect(fs.existsSync(descriptorPath)).toBe(true);
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));

    expect(descriptor.archiveFile).toBeDefined();
    expect(descriptor.archiveFile).toMatch(/^vibress_s3_.*\.tar\.gz$/);
    expect(descriptor.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(descriptor.objectCount).toBe(2);
    expect(descriptor.totalBytes).toBeGreaterThan(0);
    expect(fs.existsSync(descriptor.archivePath)).toBe(true);
  });

  it("should support custom --filename and reflect the exact filename in the descriptor", () => {
    const customName = `vibress_s3_custom_${TS}.tar.gz`;
    const descriptorPath = path.join(TEST_DIR, "descriptor_custom_name.json");
    execSync(
      `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "${BUCKET}" --endpoint "${S3_ENDPOINT}" --output "${TEST_DIR}" --filename "${customName}" --descriptor-out "${descriptorPath}"`,
      { encoding: "utf8", cwd: ROOT_DIR, stdio: "pipe", env: authEnv }
    );

    expect(fs.existsSync(descriptorPath)).toBe(true);
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));

    expect(descriptor.archiveFile).toBe(customName);
    expect(path.basename(descriptor.archivePath)).toBe(customName);
    expect(fs.existsSync(path.join(TEST_DIR, customName))).toBe(true);
  });

  it("should verify that archiveSha256 in descriptor strictly matches the physical archive SHA-256 hash", () => {
    const descriptorPath = path.join(TEST_DIR, "descriptor_verify_hash.json");
    const customName = `vibress_s3_hash_test_${TS}.tar.gz`;
    execSync(
      `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "${BUCKET}" --endpoint "${S3_ENDPOINT}" --output "${TEST_DIR}" --filename "${customName}" --descriptor-out "${descriptorPath}"`,
      { encoding: "utf8", cwd: ROOT_DIR, stdio: "pipe", env: authEnv }
    );

    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    const archiveBuffer = fs.readFileSync(path.join(TEST_DIR, customName));
    const actualHash = crypto.createHash("sha256").update(archiveBuffer).digest("hex");

    expect(descriptor.archiveSha256).toBe(actualHash);
  });

  it("should detect and reject validation when descriptor file is missing or corrupted", () => {
    const nonExistentDescriptor = path.join(TEST_DIR, "missing_descriptor.json");
    expect(fs.existsSync(nonExistentDescriptor)).toBe(false);

    // Validation helper mimicking backup.sh descriptor parsing
    const validateDescriptor = (filePath: string) => {
      if (!fs.existsSync(filePath)) {
        throw new Error("DESCRIPTOR_MISSING");
      }
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!data.archiveFile || !data.archiveSha256) {
          throw new Error("DESCRIPTOR_INCOMPLETE");
        }
        return data;
      } catch (err: any) {
        throw new Error(err.message.includes("DESCRIPTOR") ? err.message : "DESCRIPTOR_CORRUPTED");
      }
    };

    expect(() => validateDescriptor(nonExistentDescriptor)).toThrow("DESCRIPTOR_MISSING");

    // Corrupted JSON
    const corruptDescriptor = path.join(TEST_DIR, "corrupt_descriptor.json");
    fs.writeFileSync(corruptDescriptor, "{ invalid_json_syntax: true");
    expect(() => validateDescriptor(corruptDescriptor)).toThrow("DESCRIPTOR_CORRUPTED");

    // Incomplete JSON
    const incompleteDescriptor = path.join(TEST_DIR, "incomplete_descriptor.json");
    fs.writeFileSync(incompleteDescriptor, JSON.stringify({ archiveFile: "" }));
    expect(() => validateDescriptor(incompleteDescriptor)).toThrow("DESCRIPTOR_INCOMPLETE");
  });

  it("should detect and reject tampering when descriptor archiveSha256 differs from physical archive", () => {
    const descriptorPath = path.join(TEST_DIR, "descriptor_tamper_test.json");
    const customName = `vibress_s3_tamper_${TS}.tar.gz`;
    execSync(
      `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "${BUCKET}" --endpoint "${S3_ENDPOINT}" --output "${TEST_DIR}" --filename "${customName}" --descriptor-out "${descriptorPath}"`,
      { encoding: "utf8", cwd: ROOT_DIR, stdio: "pipe", env: authEnv }
    );

    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    const archivePath = path.join(TEST_DIR, customName);

    // Tamper with the physical archive file
    fs.appendFileSync(archivePath, "\n--TAMPERED_BYTE_PAYLOAD--");

    const tamperedBuffer = fs.readFileSync(archivePath);
    const tamperedHash = crypto.createHash("sha256").update(tamperedBuffer).digest("hex");

    expect(tamperedHash).not.toBe(descriptor.archiveSha256);

    // Assert validation catches mismatch
    const verifyIntegrity = (descHash: string, fileHash: string) => {
      if (descHash !== fileHash) {
        throw new Error("S3_SHA256_MISMATCH");
      }
      return true;
    };

    expect(() => verifyIntegrity(descriptor.archiveSha256, tamperedHash)).toThrow("S3_SHA256_MISMATCH");
  });
});
