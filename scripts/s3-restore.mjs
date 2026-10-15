#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { execSync } from "node:child_process";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
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

let archiveFile = getArg("--archive", "");
if (!archiveFile && args.length > 0 && !args[0].startsWith("--")) {
  archiveFile = args[0];
}

const targetBucket = getArg("--bucket", process.env.TARGET_S3_BUCKET || process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "");
const endpoint = getArg("--endpoint", process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT_URL || process.env.STORAGE_S3_ENDPOINT || "");
const region = getArg("--region", process.env.S3_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1");
const legacyAccessKey = getArg("--access-key", "");
const legacySecretKey = getArg("--secret-key", "");

if (legacySecretKey) {
  console.warn(
    "[SECURITY WARNING] Passing secrets via --secret-key CLI argument is deprecated. " +
    "Process arguments may be inspected in OS process tables. Pass credentials via " +
    "S3_SECRET_ACCESS_KEY environment variable or AWS credential files instead."
  );
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

const targetPrefix = getArg("--prefix", process.env.S3_RESTORE_PREFIX || "");
const forcePathStyleArg = getArg("--force-path-style", "");
const skipChecksum = hasFlag("--skip-checksum");
let confirmed = hasFlag("--confirm") || ["yes", "true"].includes(process.env.CONFIRM_DESTRUCTIVE_RESTORE || "");

function redactSecret(str) {
  if (!str) return "<none/provider-chain>";
  if (str.length <= 6) return "***";
  return `${str.slice(0, 3)}...${str.slice(-3)}`;
}

console.log("================================================================================");
console.log(" Vibress S3 / Object Storage Restore");
console.log(` Source Archive:  ${archiveFile || "<not specified>"}`);
console.log(` Target Bucket:   ${targetBucket || "<not specified>"}`);
console.log(` Target Prefix:   ${targetPrefix ? `"${targetPrefix}"` : "<root>"}`);
console.log(` Endpoint:        ${endpoint || "AWS Standard"}`);
console.log(` Region:          ${region}`);
console.log(` Access Key:      ${redactSecret(accessKeyId)}`);
console.log("================================================================================");

// Validate parameters
if (!archiveFile) {
  console.error("✗ S3 Restore Failure: Backup archive file is required (--archive <file>).");
  process.exit(1);
}
if (!fs.existsSync(archiveFile)) {
  console.error(`✗ S3 Restore Failure: Backup file not found: ${archiveFile}`);
  process.exit(1);
}
if (!targetBucket) {
  console.error("✗ S3 Restore Failure: Target bucket is required (--bucket <name> or TARGET_S3_BUCKET).");
  process.exit(1);
}

// For custom/local endpoints (like MinIO), credentials are required
if (
  endpoint &&
  (endpoint.includes("localhost") || endpoint.includes("127.0.0.1") || endpoint.includes("minio")) &&
  (!accessKeyId || !secretAccessKey)
) {
  console.error("✗ S3 Restore Failure: Storage credentials (S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY) are required for custom S3 endpoint.");
  process.exit(1);
}

const stagingDir = path.join(path.dirname(archiveFile), `.s3_restore_staging_${Date.now()}_${process.pid}`);

function cleanupStaging() {
  if (fs.existsSync(stagingDir)) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function promptConfirm() {
  if (confirmed) return;
  if (!process.stdin.isTTY) {
    console.error("✗ S3 Restore Failure: Destructive restore requires explicit confirmation in non-interactive mode.");
    console.error("  Pass '--confirm' or set CONFIRM_DESTRUCTIVE_RESTORE=yes.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Type 'RESTORE' to proceed with overwrite into '${targetBucket}': `, (answer) => {
      rl.close();
      if (answer.trim() === "RESTORE") {
        resolve();
      } else {
        console.log("Restore operation cancelled by operator.");
        process.exit(1);
      }
    });
  });
}

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function runRestore() {
  const startTime = Date.now();
  try {
    // Step 1: Pre-restore Checksum Verification
    console.log("[1/5] Verifying archive checksum and format...");
    const checksumFile = `${archiveFile}.sha256`;
    if (!skipChecksum && fs.existsSync(checksumFile)) {
      const checksumContent = fs.readFileSync(checksumFile, "utf8").trim();
      const expectedHash = checksumContent.split(/\s+/)[0];
      const archiveBuffer = fs.readFileSync(archiveFile);
      const actualHash = crypto.createHash("sha256").update(archiveBuffer).digest("hex");
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(`Checksum mismatch! Expected: ${expectedHash}, Actual: ${actualHash}`);
      }
      console.log(`✓ Archive SHA-256 verified successfully (${actualHash.slice(0, 16)}...).`);
    } else if (!skipChecksum) {
      console.log("ℹ Notice: No companion .sha256 file found. Proceeding with caution.");
    }

    // Verify gzip and tar integrity
    execSync(`gzip -t "${archiveFile}"`, { stdio: "pipe" });
    execSync(`tar -tzf "${archiveFile}" >/dev/null`, { stdio: "pipe" });
    console.log("✓ Archive format integrity verified.");

    // Step 2: Destructive Confirmation Gate
    console.log("\n--------------------------------------------------------------------------------");
    console.log(" ATTENTION: DESTRUCTIVE S3 RESTORE OPERATION");
    console.log(` Target Bucket: ${targetBucket}`);
    console.log(` Target Prefix: ${targetPrefix ? `"${targetPrefix}"` : "<root>"}`);
    console.log(" Existing objects in target destination may be overwritten.");
    console.log("--------------------------------------------------------------------------------");
    await promptConfirm();

    // Step 3: Unpack Archive into Staging
    console.log("\n[2/5] Unpacking archive and reading inventory manifest...");
    fs.mkdirSync(stagingDir, { recursive: true });
    execSync(`tar -xzf "${archiveFile}" -C "${stagingDir}"`, { stdio: "pipe" });

    const manifestPath = path.join(stagingDir, "inventory.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("Invalid S3 backup archive: 'inventory.json' manifest missing from archive root.");
    }

    const inventory = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const objects = inventory.objects || [];
    console.log(`✓ Manifest verified: contains ${objects.length} object(s) originally from '${inventory.bucket}'.`);

    // Step 4: S3 Client and Destination Bucket Preparation
    console.log("\n[3/5] Connecting to target S3 storage provider...");
    const forcePathStyle = forcePathStyleArg !== ""
      ? forcePathStyleArg === "true"
      : Boolean(endpoint && (endpoint.includes("localhost") || endpoint.includes("127.0.0.1") || endpoint.includes("minio")));

    const clientConfig = {
      region,
      forcePathStyle,
    };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }
    if (endpoint) clientConfig.endpoint = endpoint;

    const client = new S3Client(clientConfig);

    // Verify or create destination bucket
    try {
      await client.send(new HeadBucketCommand({ Bucket: targetBucket }));
      console.log(`✓ Target bucket '${targetBucket}' exists and is accessible.`);
    } catch {
      console.log(`Creating target bucket '${targetBucket}'...`);
      try {
        await client.send(new CreateBucketCommand({ Bucket: targetBucket }));
        console.log(`✓ Target bucket '${targetBucket}' created.`);
      } catch (createErr) {
        throw new Error(`Target bucket '${targetBucket}' cannot be accessed or created: ${createErr.message}`);
      }
    }

    // Step 5: Upload Restored Objects
    console.log(`\n[4/5] Uploading ${objects.length} object(s) to '${targetBucket}'...`);
    const objectsStagingDir = path.join(stagingDir, "objects");
    let totalBytesUploaded = 0;

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const filePath = path.join(objectsStagingDir, obj.key);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Corrupt archive: object file missing from archive: ${obj.key}`);
      }

      const fileBuffer = fs.readFileSync(filePath);
      const computedHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      if (obj.sha256 && computedHash !== obj.sha256) {
        throw new Error(`Corrupt archive: SHA-256 mismatch for ${obj.key}: expected ${obj.sha256}, got ${computedHash}`);
      }

      // Compute destination key with optional prefix
      let destKey = obj.key;
      if (targetPrefix) {
        const cleanPrefix = targetPrefix.endsWith("/") ? targetPrefix : `${targetPrefix}/`;
        destKey = `${cleanPrefix}${obj.key.replace(/^\/+/, "")}`;
      }

      const putCmd = new PutObjectCommand({
        Bucket: targetBucket,
        Key: destKey,
        Body: fileBuffer,
        ContentType: obj.contentType || "application/octet-stream",
        Metadata: obj.metadata || {},
      });

      await client.send(putCmd);
      totalBytesUploaded += fileBuffer.length;

      if ((i + 1) % 50 === 0 || i === objects.length - 1) {
        console.log(`  - Uploaded ${i + 1}/${objects.length} objects (${(totalBytesUploaded / 1024).toFixed(1)} KB)`);
      }
    }

    // Step 6: Parity and Integrity Verification
    console.log("\n[5/5] Verifying restored object integrity and parity in target storage...");
    let verifiedCount = 0;
    for (const obj of objects) {
      let destKey = obj.key;
      if (targetPrefix) {
        const cleanPrefix = targetPrefix.endsWith("/") ? targetPrefix : `${targetPrefix}/`;
        destKey = `${cleanPrefix}${obj.key.replace(/^\/+/, "")}`;
      }

      const getCmd = new GetObjectCommand({ Bucket: targetBucket, Key: destKey });
      const getRes = await client.send(getCmd);
      const readBuffer = await streamToBuffer(getRes.Body);
      const readHash = crypto.createHash("sha256").update(readBuffer).digest("hex");

      if (readHash !== obj.sha256) {
        throw new Error(`Verification mismatch on restored object '${destKey}': hash ${readHash} != expected ${obj.sha256}`);
      }
      verifiedCount++;
    }
    console.log(`✓ 100% byte-for-byte parity verified across all ${verifiedCount} restored objects.`);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("================================================================================");
    console.log(`✓ Vibress S3 Restore Completed Successfully in ${elapsedSec}s`);
    console.log(`  Target Bucket:    ${targetBucket}`);
    console.log(`  Target Prefix:    ${targetPrefix ? `"${targetPrefix}"` : "<root>"}`);
    console.log(`  Restored Objects: ${verifiedCount}`);
    console.log(`  Bytes Restored:   ${totalBytesUploaded} bytes`);
    console.log("================================================================================");

    cleanupStaging();
    process.exit(0);
  } catch (err) {
    cleanupStaging();
    console.error(`\n✗ S3 RESTORE FAILED: ${err.message}`);
    process.exit(1);
  }
}

runRestore();
