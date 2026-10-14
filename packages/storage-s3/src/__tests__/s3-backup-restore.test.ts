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
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

describe("S3 Fail-Closed Backup & Full Object Restoration", () => {
  const S3_ENDPOINT = "http://127.0.0.1:9000";
  const S3_REGION = "us-east-1";
  const S3_ACCESS_KEY = "minioadmin";
  const S3_SECRET_KEY = "minioadmin";
  const TS = Date.now();
  const SRC_BUCKET = `test-backup-src-${TS}`;
  const DEST_BUCKET = `test-backup-dest-${TS}`;
  const ROOT_DIR = path.resolve(__dirname, "../../../../");
  const BACKUP_SCRIPT = path.join(ROOT_DIR, "scripts/s3-backup.mjs");
  const RESTORE_SCRIPT = path.join(ROOT_DIR, "scripts/s3-restore.mjs");
  const TEST_DIR = path.resolve(ROOT_DIR, `backups/test_vitest_${TS}`);

  const s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    forcePathStyle: true,
  });

  beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: SRC_BUCKET }));
    } catch {
      // ignore
    }
  });

  afterAll(async () => {
    async function cleanBucket(b: string) {
      try {
        const list = await s3Client.send(new ListObjectsV2Command({ Bucket: b }));
        if (list.Contents) {
          for (const item of list.Contents) {
            if (item.Key) await s3Client.send(new DeleteObjectCommand({ Bucket: b, Key: item.Key }));
          }
        }
        await s3Client.send(new DeleteBucketCommand({ Bucket: b }));
      } catch {
        // ignore
      }
    }
    await cleanBucket(SRC_BUCKET);
    await cleanBucket(DEST_BUCKET);
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should fail closed (exit 1) when bucket name is missing", () => {
    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --output "${TEST_DIR}"`,
        { stdio: "pipe", cwd: ROOT_DIR }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it("should fail closed (exit 1) when credentials are missing", () => {
    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "${SRC_BUCKET}" --access-key "" --secret-key "" --output "${TEST_DIR}"`,
        { stdio: "pipe", cwd: ROOT_DIR }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it("should fail closed (exit 1) when bucket is inaccessible", () => {
    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "nonexistent-bucket-9999" --endpoint "${S3_ENDPOINT}" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --output "${TEST_DIR}"`,
        { stdio: "pipe", cwd: ROOT_DIR }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it("should fail closed (exit 1) on restore when archive does not exist", () => {
    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${RESTORE_SCRIPT}" --archive "/tmp/missing-file-${TS}.tar.gz" --bucket "${DEST_BUCKET}" --endpoint "${S3_ENDPOINT}" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --confirm`,
        { stdio: "pipe", cwd: ROOT_DIR }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it("should fail closed (exit 1) on restore when archive is corrupted", () => {
    const corruptArchive = path.join(TEST_DIR, "corrupt.tar.gz");
    fs.writeFileSync(corruptArchive, "not-a-valid-tar-gz-content");

    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${RESTORE_SCRIPT}" --archive "${corruptArchive}" --bucket "${DEST_BUCKET}" --endpoint "${S3_ENDPOINT}" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --confirm --skip-checksum`,
        { stdio: "pipe", cwd: ROOT_DIR }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it("should fail closed (exit 1) on restore when checksum does not match", () => {
    const fakeArchive = path.join(TEST_DIR, "tampered.tar.gz");
    execSync(`tar -czf "${fakeArchive}" -C "${TEST_DIR}" . 2>/dev/null || true`, { cwd: ROOT_DIR });
    if (!fs.existsSync(fakeArchive)) fs.writeFileSync(fakeArchive, "fallback");
    const badChecksum = path.join(TEST_DIR, "tampered.tar.gz.sha256");
    fs.writeFileSync(badChecksum, "0000000000000000000000000000000000000000000000000000000000000000  tampered.tar.gz\n");

    let failed = false;
    try {
      execSync(
        `pnpm exec tsx "${RESTORE_SCRIPT}" --archive "${fakeArchive}" --bucket "${DEST_BUCKET}" --endpoint "${S3_ENDPOINT}" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --confirm`,
        { stdio: "pipe", cwd: ROOT_DIR }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it("should perform full round-trip backup & restore to isolated bucket with byte-for-byte parity", async () => {
    const asset1Body = Buffer.from("media-content-photo-binary-12345");
    const asset2Body = Buffer.from(JSON.stringify({ theme: "dr-roundtrip", version: "1.2.0" }));
    const asset1Hash = crypto.createHash("sha256").update(asset1Body).digest("hex");
    const asset2Hash = crypto.createHash("sha256").update(asset2Body).digest("hex");

    await s3Client.send(
      new PutObjectCommand({
        Bucket: SRC_BUCKET,
        Key: "media/photo.png",
        Body: asset1Body,
        ContentType: "image/png",
        Metadata: { role: "hero" },
      })
    );
    await s3Client.send(
      new PutObjectCommand({
        Bucket: SRC_BUCKET,
        Key: "themes/active/manifest.json",
        Body: asset2Body,
        ContentType: "application/json",
      })
    );

    // 1. Run backup
    const backupOut = execSync(
      `pnpm exec tsx "${BACKUP_SCRIPT}" --bucket "${SRC_BUCKET}" --endpoint "${S3_ENDPOINT}" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --output "${TEST_DIR}"`,
      { encoding: "utf8", cwd: ROOT_DIR }
    );
    expect(backupOut).toContain("Vibress S3 Backup Completed Successfully");

    const files = fs.readdirSync(TEST_DIR).filter((f) => f.startsWith("vibress_s3_") && f.endsWith(".tar.gz"));
    expect(files.length).toBeGreaterThan(0);
    const archivePath = path.join(TEST_DIR, files[0]);
    expect(fs.existsSync(`${archivePath}.sha256`)).toBe(true);

    // 2. Run restore into isolated destination bucket
    const restoreOut = execSync(
      `pnpm exec tsx "${RESTORE_SCRIPT}" --archive "${archivePath}" --bucket "${DEST_BUCKET}" --endpoint "${S3_ENDPOINT}" --access-key "${S3_ACCESS_KEY}" --secret-key "${S3_SECRET_KEY}" --confirm`,
      { encoding: "utf8", cwd: ROOT_DIR }
    );
    expect(restoreOut).toContain("100% byte-for-byte parity verified");

    // 3. Directly inspect restored objects in DEST_BUCKET
    const get1 = await s3Client.send(new GetObjectCommand({ Bucket: DEST_BUCKET, Key: "media/photo.png" }));
    const chunks1: Buffer[] = [];
    for await (const chunk of get1.Body as any) chunks1.push(chunk);
    const read1 = Buffer.concat(chunks1);
    expect(crypto.createHash("sha256").update(read1).digest("hex")).toBe(asset1Hash);
    expect(get1.ContentType).toBe("image/png");

    const get2 = await s3Client.send(new GetObjectCommand({ Bucket: DEST_BUCKET, Key: "themes/active/manifest.json" }));
    const chunks2: Buffer[] = [];
    for await (const chunk of get2.Body as any) chunks2.push(chunk);
    const read2 = Buffer.concat(chunks2);
    expect(crypto.createHash("sha256").update(read2).digest("hex")).toBe(asset2Hash);
  });
});
