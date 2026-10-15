#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} from "../packages/storage-s3/node_modules/@aws-sdk/client-s3/dist-cjs/index.js";

// Helper to load environment file
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      const key = match[1];
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(flag, fallback = "") {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const envFile = getArg("--env-file", process.env.ENV_FILE || ".env");
loadEnvFile(envFile);

const bucket = getArg("--bucket", process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "");
const endpoint = getArg("--endpoint", process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT_URL || process.env.STORAGE_S3_ENDPOINT || "");
const region = getArg("--region", process.env.S3_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1");
const legacyAccessKey = getArg("--access-key", "");
const legacySecretKey = getArg("--secret-key", "");

if (legacySecretKey) {
  console.error(
    "[SECURITY ERROR] Passing secrets via --secret-key CLI argument is strictly forbidden. " +
    "Command line arguments are observable in OS process tables (ps, /proc). " +
    "Supply credentials securely via S3_SECRET_ACCESS_KEY environment variable or AWS credential files instead."
  );
  process.exit(1);
}

const accessKeyId =
  process.env.S3_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID ||
  legacyAccessKey ||
  "";

const secretAccessKey =
  process.env.S3_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY ||
  legacySecretKey ||
  "";

const prefix = getArg("--prefix", process.env.S3_PREFIX || "");
const outputDir = getArg("--output", process.env.BACKUP_DIR || "./backups");
const forcePathStyleArg = getArg("--force-path-style", "");
const allowEmpty = hasFlag("--allow-empty");

// Redact secret helper
function redactSecret(str) {
  if (!str) return "<none/provider-chain>";
  if (str.length <= 6) return "***";
  return `${str.slice(0, 3)}...${str.slice(-3)}`;
}

console.log("================================================================================");
console.log(" Vibress S3 / Object Storage Backup");
console.log(` Bucket:          ${bucket || "<not specified>"}`);
console.log(` Endpoint:        ${endpoint || "AWS Standard"}`);
console.log(` Region:          ${region}`);
console.log(` Access Key:      ${redactSecret(accessKeyId)}`);
console.log(` Prefix Filter:   ${prefix ? `"${prefix}"` : "<all objects>"}`);
console.log(` Output Dir:      ${outputDir}`);
console.log("================================================================================");

// Validate requirements (fail-closed)
if (!bucket) {
  console.error("✗ S3 Backup Failure: Bucket name is required (--bucket or S3_BUCKET).");
  process.exit(1);
}

// For custom/local endpoints (like MinIO), credentials are required
if (
  endpoint &&
  (endpoint.includes("localhost") || endpoint.includes("127.0.0.1") || endpoint.includes("minio")) &&
  (!accessKeyId || !secretAccessKey)
) {
  console.error("✗ S3 Backup Failure: Storage credentials (S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY) are required for custom S3 endpoint.");
  process.exit(1);
}

const forcePathStyle = forcePathStyleArg !== ""
  ? forcePathStyleArg === "true"
  : Boolean(endpoint && (endpoint.includes("localhost") || endpoint.includes("127.0.0.1") || endpoint.includes("minio")));

const clientConfig = {
  region,
  forcePathStyle,
};

if (accessKeyId && secretAccessKey) {
  clientConfig.credentials = {
    accessKeyId,
    secretAccessKey,
  };
}
if (endpoint) {
  clientConfig.endpoint = endpoint;
}

const client = new S3Client(clientConfig);

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
const archiveBasename = `vibress_s3_${timestamp}.tar.gz`;
const finalArchive = path.join(outputDir, archiveBasename);
const stagingDir = path.join(outputDir, `.s3_backup_staging_${timestamp}_${process.pid}`);

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(stagingDir, { recursive: true });

function cleanupStaging() {
  if (fs.existsSync(stagingDir)) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function runBackup() {
  const startTime = Date.now();
  try {
    // Step 1: Verify bucket accessibility (fail-closed)
    console.log(`[1/4] Verifying bucket connectivity for '${bucket}'...`);
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      console.log(`✓ Bucket '${bucket}' is accessible.`);
    } catch (err) {
      throw new Error(`Failed to access bucket '${bucket}': ${err.message || err.name || "Access Denied"}`);
    }

    // Step 2: List all objects under prefix
    console.log(`[2/4] Listing objects in bucket '${bucket}'${prefix ? ` (prefix: '${prefix}')` : ""}...`);
    const objects = [];
    let continuationToken;
    do {
      const listCmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      });
      const res = await client.send(listCmd);
      if (res.Contents) {
        for (const item of res.Contents) {
          if (item.Key && !item.Key.endsWith("/")) {
            objects.push({
              key: item.Key,
              size: item.Size || 0,
              lastModified: item.LastModified ? item.LastModified.toISOString() : null,
              etag: item.ETag || null,
            });
          }
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    console.log(`Found ${objects.length} object(s) in S3.`);
    if (objects.length === 0 && !allowEmpty) {
      console.log("ℹ Notice: Bucket contains 0 objects under prefix. Writing empty inventory.");
    }

    // Step 3: Download objects and build inventory
    console.log(`[3/4] Downloading objects and computing checksums...`);
    const inventory = {
      bucket,
      endpoint: endpoint || "aws-standard",
      region,
      prefix,
      backupTimestamp: new Date().toISOString(),
      objectCount: objects.length,
      objects: [],
    };

    const objectsStagingDir = path.join(stagingDir, "objects");
    fs.mkdirSync(objectsStagingDir, { recursive: true });

    let totalBytes = 0;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const getCmd = new GetObjectCommand({ Bucket: bucket, Key: obj.key });
      const getRes = await client.send(getCmd);

      const buffer = await streamToBuffer(getRes.Body);
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

      // Fetch head object for user metadata
      let metadata = {};
      let contentType = getRes.ContentType || "application/octet-stream";
      try {
        const headCmd = new HeadObjectCommand({ Bucket: bucket, Key: obj.key });
        const headRes = await client.send(headCmd);
        if (headRes.Metadata) metadata = headRes.Metadata;
        if (headRes.ContentType) contentType = headRes.ContentType;
      } catch {
        // use getRes metadata
      }

      // Save object to relative path inside staging
      const targetFilePath = path.join(objectsStagingDir, obj.key);
      fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
      fs.writeFileSync(targetFilePath, buffer);

      inventory.objects.push({
        key: obj.key,
        size: buffer.length,
        sha256,
        contentType,
        metadata,
        lastModified: obj.lastModified,
      });

      totalBytes += buffer.length;
      if ((i + 1) % 50 === 0 || i === objects.length - 1) {
        console.log(`  - Downloaded ${i + 1}/${objects.length} objects (${(totalBytes / 1024).toFixed(1)} KB)`);
      }
    }

    // Write inventory manifest into staging
    const manifestPath = path.join(stagingDir, "inventory.json");
    fs.writeFileSync(manifestPath, JSON.stringify(inventory, null, 2), "utf8");

    // Step 4: Archive and create checksum
    console.log(`[4/4] Packing atomic compressed archive and computing archive checksum...`);
    const tmpArchive = `${finalArchive}.tmp.${process.pid}`;
    execSync(`tar -czf "${tmpArchive}" -C "${stagingDir}" .`, { stdio: "pipe" });

    // Validate archive integrity before publishing
    execSync(`gzip -t "${tmpArchive}"`, { stdio: "pipe" });
    execSync(`tar -tzf "${tmpArchive}" >/dev/null`, { stdio: "pipe" });

    fs.renameSync(tmpArchive, finalArchive);
    fs.chmodSync(finalArchive, 0o600);

    // Write companion SHA-256 checksum file
    const archiveBuffer = fs.readFileSync(finalArchive);
    const archiveSha256 = crypto.createHash("sha256").update(archiveBuffer).digest("hex");
    const checksumFile = `${finalArchive}.sha256`;
    fs.writeFileSync(checksumFile, `${archiveSha256}  ${archiveBasename}\n`, "utf8");
    fs.chmodSync(checksumFile, 0o600);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    const archiveSizeMb = (fs.statSync(finalArchive).size / (1024 * 1024)).toFixed(2);

    console.log("================================================================================");
    console.log(`✓ Vibress S3 Backup Completed Successfully in ${elapsedSec}s`);
    console.log(`  Archive:    ${finalArchive} (${archiveSizeMb} MB)`);
    console.log(`  Checksum:   ${checksumFile} (${archiveSha256.slice(0, 16)}...)`);
    console.log(`  Objects:    ${inventory.objectCount}`);
    console.log(`  Raw Bytes:  ${totalBytes} bytes`);
    console.log("================================================================================");

    cleanupStaging();
    process.exit(0);
  } catch (err) {
    cleanupStaging();
    console.error(`\n✗ S3 BACKUP FAILED: ${err.message}`);
    process.exit(1);
  }
}

runBackup();
