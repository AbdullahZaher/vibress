// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getDb,
  getDbPool,
  closeDbPool,
  runMigrations,
  seedDatabase,
  Client,
  publications,
  publicationLocales,
  plugins,
  pluginPublicationStates,
  pluginPhysicalModels,
  eq,
  users,
  sessions,
  publicationMemberships,
} from "@vibress/database";
import { hashToken, generateOpaqueToken } from "@vibress/security";
import type { PluginManifest } from "@vibress/plugin-sdk";
import {
  PluginsService,
  PluginPhysicalSchemaMigrationService,
  DrizzlePluginStorageMigrationRepository,
  DrizzlePluginRepository,
  DrizzlePluginSettingRepository,
  DrizzlePluginPublicationStateRepository,
  DrizzlePluginPublicationSettingRepository,
  createHostPluginStorageSession,
} from "@vibress/plugins";
import { BundledPluginHost } from "../../apps/api/src/plugins/plugin-host";
import { readVerifiedOperatorMigrationPlan } from "../../scripts/plugins/read-verified-migration-plan";
import { resolveAndBuildLmsAuthoringArtifacts } from "../helpers/lms-source-provider";

const repoRoot = path.resolve(__dirname, "../..");
const sharedSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const rotatedSecret = "f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6b5a43210";

/**
 * Dynamically binds an ephemeral socket to find an open available TCP port.
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to obtain port")));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * Allocates multiple distinct ephemeral ports without collisions.
 */
async function allocateDistinctPorts(count: number): Promise<number[]> {
  const ports = new Set<number>();
  while (ports.size < count) {
    const p = await getAvailablePort();
    ports.add(p);
  }
  return Array.from(ports);
}

/**
 * Gracefully terminates a child process using SIGTERM with bounded timeout fallback to SIGKILL.
 */
async function terminateProcessGracefully(proc: ChildProcess | null, timeoutMs = 4000): Promise<void> {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  return new Promise<void>((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    proc.once("exit", cleanup);

    try {
      proc.kill("SIGTERM");
    } catch {
      cleanup();
      return;
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already killed
        }
        cleanup();
      }
    }, timeoutMs);

    proc.once("exit", () => {
      clearTimeout(timer);
      cleanup();
    });
  });
}

/**
 * Polls an HTTP endpoint until it returns status 200 or timeout expires.
 */
async function waitForHealthy(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // Waiting for socket to open
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout waiting for ${url} to become healthy`);
}

/**
 * Spawns an independent API process with explicit environment variables.
 */
function spawnReplicaProcess(
  port: number,
  dbUrl: string,
  encryptionKey: string,
  lockfilePath: string,
  keyPath: string,
  sigPath: string,
  releaseTag: string,
  allowedPorts: number[],
  actionReleaseTag = releaseTag,
): ChildProcess {
  const tsxBin = path.resolve(repoRoot, "node_modules/.bin/tsx");
  const corsOrigins = allowedPorts
    .flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])
    .join(",");

  return spawn(
    tsxBin,
    ["apps/api/src/main.ts"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        API_PORT: String(port),
        PORT: String(port),
        DATABASE_URL: dbUrl,
        REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6380",
        VIBRESS_TRUSTED_PLUGIN_LOCKFILE: lockfilePath,
        VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE: keyPath,
        VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE: sigPath,
        VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1",
        // These environment variables are optional *or* strict release IDs.
        // An empty string fails Host config validation before HTTP startup.
        // Setting undefined intentionally omits disabled flags from child env.
        VIBRESS_NATIVE_ADMIN_UI_RELEASES: releaseTag || undefined,
        VIBRESS_NATIVE_ADMIN_ACTION_RELEASES: actionReleaseTag || undefined,
        VIBRESS_ENCRYPTION_KEY: encryptionKey,
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
        CORS_ORIGINS: corsOrigins,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

describe("Priority 1: Real Independent Multi-Process API Replicas with PostgreSQL and Redis", () => {
  let tempDir: string;
  let lockfilePath: string;
  let planPath: string;
  let artifactPath: string;
  let keyPath: string;
  let sigPath: string;

  let procA: ChildProcess | null = null;
  let procB: ChildProcess | null = null;
  let procC: ChildProcess | null = null;

  let portA: number;
  let portB: number;
  let portC: number;

  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const dbName = `vibress_replica_${runId}`;

  const pubAId = `pub-rep-a-${runId}`;
  const pubBId = `pub-rep-b-${runId}`;
  const domainA = `rep-a-${runId}.localhost`;
  const domainB = `rep-b-${runId}.localhost`;

  const rawStaffToken = generateOpaqueToken();
  let staffSessionToken: string = "";
  let staffUserId: string = "";
  let registeredPluginId: string = "";
  let approvedReleaseTag: string = "";
  let manifest: PluginManifest;

  const originalEnv = { ...process.env };
  const originalDbUrl =
    process.env.DATABASE_URL || "postgresql://vibress:vibress@127.0.0.1:5432/vibress";

  let adminClient: Client;
  let disposableDbUrl: string = "";

  beforeAll(async () => {
    // 1. Resolve and build real LMS authoring artifacts
    const lmsArtifacts = await resolveAndBuildLmsAuthoringArtifacts();

    // 2. Stage artifacts and generate Ed25519 signing keypair
    tempDir = await mkdtemp(path.join(tmpdir(), "vibress-multi-process-"));
    artifactPath = path.join(tempDir, "vibress-lms-authoring.mjs");
    planPath = path.join(tempDir, "operator-migration-plan.json");
    lockfilePath = path.join(tempDir, "trusted-plugins.json");
    keyPath = path.join(tempDir, "operator-public.pem");
    sigPath = path.join(tempDir, "operator.sig");

    await copyFile(lmsArtifacts.artifactPath, artifactPath);
    await copyFile(lmsArtifacts.planPath, planPath);
    await copyFile(lmsArtifacts.lockfilePath, lockfilePath);
    await copyFile(lmsArtifacts.adminHtmlPath, path.join(tempDir, "courses.html"));
    await copyFile(lmsArtifacts.studentHtmlPath, path.join(tempDir, "student.html"));

    const lockBytes = await readFile(lockfilePath);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    await writeFile(keyPath, publicKey.export({ format: "pem", type: "spki" }));
    await writeFile(sigPath, sign(null, lockBytes, privateKey).toString("base64") + "\n");

    const lockData = JSON.parse(lockBytes.toString("utf8")) as {
      schemaVersion: number;
      plugins: Array<{ manifest: PluginManifest }>;
    };
    manifest = lockData.plugins[0]!.manifest;

    const releaseDigest = createHash("sha256")
      .update(await readFile(artifactPath))
      .digest("hex");
    approvedReleaseTag = `${manifest.id}@${releaseDigest}`;

    // 3. Create isolated PostgreSQL database for real multi-process verification
    const adminUrl = new URL(originalDbUrl);
    adminUrl.pathname = "/postgres";
    adminClient = new Client({ connectionString: adminUrl.toString() });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE ${dbName};`);

    const dispUrl = new URL(originalDbUrl);
    dispUrl.pathname = `/${dbName}`;
    disposableDbUrl = dispUrl.toString();
    process.env.DATABASE_URL = disposableDbUrl;
    process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE = lockfilePath;
    process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE = "1";
    process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE = keyPath;
    process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE = sigPath;
    process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE = "0";

    // 4. Run database migrations and seed baseline roles/users
    await closeDbPool();
    await runMigrations();
    await seedDatabase();

    const db = getDb();

    // 5. Register plugin and apply physical models to PostgreSQL
    const host = new BundledPluginHost(lockfilePath);
    const pluginsService = new PluginsService(
      new DrizzlePluginRepository(),
      new DrizzlePluginSettingRepository(),
      host,
      new DrizzlePluginPublicationStateRepository(),
      new DrizzlePluginPublicationSettingRepository(),
    );

    const registered = await pluginsService.registerPlugin(manifest, "operator-test");
    registeredPluginId = registered.id;

    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const migrator = new PluginPhysicalSchemaMigrationService(
      new DrizzlePluginStorageMigrationRepository(() => db),
    );
    await migrator.applyApprovedPhysical(approvedPlan);
    await pluginsService.activatePlugin(registeredPluginId, "operator-test");

    // 6. Provision two distinct publications
    await db.insert(publications).values([
      {
        id: pubAId,
        workspaceId: "ws_default",
        name: "Publication Alpha",
        slug: pubAId,
        domain: domainA,
        primaryLocale: "en",
      },
      {
        id: pubBId,
        workspaceId: "ws_default",
        name: "Publication Beta",
        slug: pubBId,
        domain: domainB,
        primaryLocale: "en",
      },
    ]);

    await db.insert(publicationLocales).values([
      { id: randomUUID(), publicationId: pubAId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubAId, locale: "ar", status: "active", isDefault: false },
      { id: randomUUID(), publicationId: pubBId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubBId, locale: "ar", status: "active", isDefault: false },
    ]);

    // Enable plugin on both publications
    await pluginsService.setPublicationEnabled(registeredPluginId, pubAId, true, "operator-test");
    await pluginsService.setPublicationEnabled(registeredPluginId, pubBId, true, "operator-test");

    // Retrieve seeded owner user and create publication membership
    const [ownerUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner@vibress.local"))
      .limit(1);
    expect(ownerUser).toBeDefined();
    staffUserId = ownerUser!.id;

    await db.insert(publicationMemberships).values([
      {
        id: randomUUID(),
        publicationId: pubAId,
        userId: staffUserId,
        role: "owner",
      },
      {
        id: randomUUID(),
        publicationId: pubBId,
        userId: staffUserId,
        role: "owner",
      },
    ]);

    // Also grant publication membership to seeded owner@example.com for real HTTP login testing
    const [exampleOwner] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner@example.com"))
      .limit(1);
    if (exampleOwner) {
      await db.insert(publicationMemberships).values([
        {
          id: randomUUID(),
          publicationId: pubAId,
          userId: exampleOwner.id,
          role: "owner",
        },
        {
          id: randomUUID(),
          publicationId: pubBId,
          userId: exampleOwner.id,
          role: "owner",
        },
      ]);
    }

    // Insert staff session directly into sessions table
    const expiresAt = new Date(Date.now() + 86400000);
    await db.insert(sessions).values({
      id: randomUUID(),
      userId: staffUserId,
      tokenHash: hashToken(rawStaffToken),
      expiresAt,
    });
    staffSessionToken = rawStaffToken;

    // 7. Seed initial publication-scoped course records in PostgreSQL
    const physicalModels = await db
      .select()
      .from(pluginPhysicalModels)
      .where(eq(pluginPhysicalModels.pluginId, registeredPluginId));
    const approvedModels = approvedPlan.models;

    // Seed 5 courses in Publication Alpha
    const sessionA = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "seed-req-a",
        allowWrites: true,
      },
      approvedModels,
    );
    try {
      for (let i = 1; i <= 5; i++) {
        const id = `course-a-${String(i).padStart(2, "0")}`;
        await sessionA.storage.create("courses", id, {
          title_en: `Course Alpha ${i}`,
          title_ar: `دورة ألفا ${i}`,
          status: "draft",
          summary_en: `Summary ${i}`,
          summary_ar: `ملخص ${i}`,
          lesson_title_en: `Lesson ${i}`,
          lesson_title_ar: `درس ${i}`,
          lesson_body_en: `Content ${i}`,
          lesson_body_ar: `محتوى ${i}`,
        });
      }
    } finally {
      await sessionA.close();
    }

    // Seed 2 courses in Publication Beta
    const sessionB = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubBId,
        actorUserId: staffUserId,
        requestId: "seed-req-b",
        allowWrites: true,
      },
      approvedModels,
    );
    try {
      for (let i = 1; i <= 2; i++) {
        const id = `course-b-${String(i).padStart(2, "0")}`;
        await sessionB.storage.create("courses", id, {
          title_en: `Course Beta ${i}`,
          title_ar: `دورة بيتا ${i}`,
          status: "draft",
          summary_en: `Summary ${i}`,
          summary_ar: `ملخص ${i}`,
          lesson_title_en: `Lesson ${i}`,
          lesson_title_ar: `درس ${i}`,
          lesson_body_en: `Content ${i}`,
          lesson_body_ar: `محتوى ${i}`,
        });
      }
    } finally {
      await sessionB.close();
    }

    // 8. Dynamically allocate 3 distinct ephemeral TCP ports
    [portA, portB, portC] = await allocateDistinctPorts(3);

    // Launch two genuinely separate Node.js OS processes for Replica A and Replica B
    procA = spawnReplicaProcess(
      portA,
      disposableDbUrl,
      sharedSecret,
      lockfilePath,
      keyPath,
      sigPath,
      approvedReleaseTag,
      [portA, portB, portC],
    );

    procB = spawnReplicaProcess(
      portB,
      disposableDbUrl,
      sharedSecret,
      lockfilePath,
      keyPath,
      sigPath,
      approvedReleaseTag,
      [portA, portB, portC],
    );

    // 9. Verify genuine separate OS processes and wait for health
    expect(procA.pid).toBeDefined();
    expect(procB.pid).toBeDefined();
    expect(procA.pid).not.toBe(procB.pid);
    expect(portA).not.toBe(portB);

    await Promise.all([
      waitForHealthy(`http://127.0.0.1:${portA}/health/live`),
      waitForHealthy(`http://127.0.0.1:${portB}/health/live`),
    ]);
  }, 120000);

  afterAll(async () => {
    // Terminate spawned child processes gracefully with SIGTERM and fallback to SIGKILL
    await Promise.all([
      terminateProcessGracefully(procA),
      terminateProcessGracefully(procB),
      terminateProcessGracefully(procC),
    ]);
    procA = null;
    procB = null;
    procC = null;

    await closeDbPool();

    // Drop disposable database
    if (adminClient) {
      try {
        if (dbName) {
          await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
        }
      } finally {
        await adminClient.end();
      }
    }

    // Restore environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies genuine process separation between Replica A and Replica B", () => {
    expect(procA).not.toBeNull();
    expect(procB).not.toBeNull();
    expect(typeof procA?.pid).toBe("number");
    expect(typeof procB?.pid).toBe("number");
    expect(procA?.pid).not.toBe(procB?.pid);
  });

  it("Scenario Auth: Real Staff authentication via HTTP login endpoint propagates across replicas", async () => {
    // 1. Authenticate via real login route on Replica A
    const loginRes = await fetch(`http://127.0.0.1:${portA}/api/admin/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${portA}`,
      },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "OwnerPass123!",
      }),
    });
    expect(loginRes.status).toBe(200);

    const setCookieHeader = loginRes.headers.get("set-cookie");
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain("vibress_session=");

    const match = setCookieHeader!.match(/vibress_session=([^;]+)/);
    expect(match).toBeDefined();
    const liveSessionCookie = `vibress_session=${match![1]}`;

    // 2. Access protected extension resource on Replica B using the session cookie issued by Replica A
    const urlB = `http://127.0.0.1:${portB}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const resB = await fetch(`${urlB}?limit=2`, {
      headers: {
        Cookie: liveSessionCookie,
        "x-publication-id": pubAId,
      },
    });
    expect(resB.status).toBe(200);
    const dataB = (await resB.json()) as { items: unknown[] };
    expect(dataB.items.length).toBeGreaterThan(0);

    // 3. Attempt invalid login credentials on Replica A: must return 401
    const badLoginRes = await fetch(`http://127.0.0.1:${portA}/api/admin/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${portA}`,
      },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "WrongPassword999!",
      }),
    });
    expect(badLoginRes.status).toBe(401);
  });

  it("Scenario A: Cross-process cursor pagination across Replica A and Replica B", async () => {
    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const urlB = `http://127.0.0.1:${portB}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

    const headers = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
    };

    // 1. Fetch first page of 2 items from Replica A
    const resA1 = await fetch(`${urlA}?limit=2`, { headers });
    expect(resA1.status).toBe(200);
    const dataA1 = (await resA1.json()) as {
      items: Array<{ id: string; version: number; fields: Record<string, string> }>;
      nextCursor?: string;
    };
    expect(dataA1.items.length).toBe(2);
    expect(dataA1.items[0]!.id).toBe("course-a-01");
    expect(dataA1.items[1]!.id).toBe("course-a-02");
    expect(dataA1.nextCursor).toBeDefined();

    // 2. Fetch second page from Replica B using cursor signed by Replica A
    const cursorA1 = dataA1.nextCursor!;
    const resB2 = await fetch(`${urlB}?limit=2&cursor=${encodeURIComponent(cursorA1)}`, { headers });
    expect(resB2.status).toBe(200);
    const dataB2 = (await resB2.json()) as {
      items: Array<{ id: string; version: number; fields: Record<string, string> }>;
      nextCursor?: string;
    };
    expect(dataB2.items.length).toBe(2);
    expect(dataB2.items[0]!.id).toBe("course-a-03");
    expect(dataB2.items[1]!.id).toBe("course-a-04");
    expect(dataB2.nextCursor).toBeDefined();

    // 3. Fetch final page back on Replica A using cursor signed by Replica B
    const cursorB2 = dataB2.nextCursor!;
    const resA3 = await fetch(`${urlA}?limit=2&cursor=${encodeURIComponent(cursorB2)}`, { headers });
    expect(resA3.status).toBe(200);
    const dataA3 = (await resA3.json()) as {
      items: Array<{ id: string; version: number; fields: Record<string, string> }>;
      nextCursor?: string;
    };
    expect(dataA3.items.length).toBe(1);
    expect(dataA3.items[0]!.id).toBe("course-a-05");
    expect(dataA3.nextCursor).toBeUndefined();

    // 4. Assert total unique set across replicas has no duplicates and correct order
    const allIds = [...dataA1.items, ...dataB2.items, ...dataA3.items].map((i) => i.id);
    expect(allIds).toEqual([
      "course-a-01",
      "course-a-02",
      "course-a-03",
      "course-a-04",
      "course-a-05",
    ]);
  });

  it("Scenario B: Publication isolation and forged header rejection", async () => {
    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

    // 1. Legitimate request to Publication Beta returns only Beta records
    const resBeta = await fetch(`${urlA}?limit=10`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": pubBId,
      },
    });
    expect(resBeta.status).toBe(200);
    const dataBeta = (await resBeta.json()) as { items: Array<{ id: string }> };
    expect(dataBeta.items.length).toBe(2);
    expect(dataBeta.items.map((i) => i.id)).toEqual(["course-b-01", "course-b-02"]);

    // 2. Forged publication ID that does not exist fails with 403
    const resForged = await fetch(`${urlA}?limit=10`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": "pub-forged-attacker-site",
      },
    });
    expect(resForged.status).toBe(403);

    // 3. Unauthorized user without membership in Publication Alpha is rejected
    const db = getDb();
    const guestUser = {
      id: randomUUID(),
      email: `guest-${runId}@example.com`,
      name: "Guest User",
      slug: `guest-${runId}`,
      passwordHash: "dummy-password-hash",
    };
    await db.insert(users).values(guestUser);
    const guestToken = generateOpaqueToken();
    await db.insert(sessions).values({
      id: randomUUID(),
      userId: guestUser.id,
      tokenHash: hashToken(guestToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const resDenied = await fetch(`${urlA}?limit=10`, {
      headers: {
        Authorization: `Bearer ${guestToken}`,
        Cookie: `vibress_session=${guestToken}`,
        "x-publication-id": pubAId,
      },
    });
    expect(resDenied.status).toBe(403);
  });

  it("Scenario C: Session revocation propagates immediately across both replicas", async () => {
    const db = getDb();

    // 1. Create a dedicated ephemeral session for revocation testing
    const ephemToken = generateOpaqueToken();
    const ephemSessionId = randomUUID();
    await db.insert(sessions).values({
      id: ephemSessionId,
      userId: staffUserId,
      tokenHash: hashToken(ephemToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const urlB = `http://127.0.0.1:${portB}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

    const ephemHeaders = {
      Authorization: `Bearer ${ephemToken}`,
      Cookie: `vibress_session=${ephemToken}`,
      "x-publication-id": pubAId,
    };

    // Verify authorized on Replica A
    const resBefore = await fetch(`${urlA}?limit=1`, { headers: ephemHeaders });
    expect(resBefore.status).toBe(200);

    // 2. Revoke the session in PostgreSQL
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, ephemSessionId));

    // 3. Subsequent requests fail closed on BOTH Replica A and Replica B
    const resAfterA = await fetch(`${urlA}?limit=1`, { headers: ephemHeaders });
    expect(resAfterA.status).toBe(401);

    const resAfterB = await fetch(`${urlB}?limit=1`, { headers: ephemHeaders });
    expect(resAfterB.status).toBe(401);
  });

  it("Scenario D: Plugin deactivation and re-enablement across both replicas", async () => {
    const db = getDb();
    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const urlB = `http://127.0.0.1:${portB}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

    const headers = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
    };

    // 1. Deactivate plugin for Publication Alpha in database
    await db
      .update(pluginPublicationStates)
      .set({ enabled: false })
      .where(
        eq(pluginPublicationStates.pluginId, registeredPluginId),
      );

    // Both replicas must return 404
    const resDisabledA = await fetch(`${urlA}?limit=2`, { headers });
    expect(resDisabledA.status).toBe(404);

    const resDisabledB = await fetch(`${urlB}?limit=2`, { headers });
    expect(resDisabledB.status).toBe(404);

    // 2. Re-enable plugin in database
    await db
      .update(pluginPublicationStates)
      .set({ enabled: true })
      .where(
        eq(pluginPublicationStates.pluginId, registeredPluginId),
      );

    // Both replicas restore access to intact records
    const resEnabledA = await fetch(`${urlA}?limit=2`, { headers });
    expect(resEnabledA.status).toBe(200);

    const resEnabledB = await fetch(`${urlB}?limit=2`, { headers });
    expect(resEnabledB.status).toBe(200);
  });

  it("Scenario E: Signing-key mismatch rejects cross-replica cursors", async () => {
    // 1. Spawn Replica C with rotated/mismatched encryption key
    procC = spawnReplicaProcess(
      portC,
      disposableDbUrl,
      rotatedSecret, // Mismatched secret
      lockfilePath,
      keyPath,
      sigPath,
      approvedReleaseTag,
      [portA, portB, portC],
    );

    await waitForHealthy(`http://127.0.0.1:${portC}/health/live`);

    // 2. Fetch cursor from Replica A (signed with sharedSecret)
    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const resA = await fetch(`${urlA}?limit=2`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": pubAId,
      },
    });
    expect(resA.status).toBe(200);
    const dataA = (await resA.json()) as { nextCursor?: string };
    expect(dataA.nextCursor).toBeDefined();

    // 3. Send cursor to Replica C: HMAC verification must fail and return 400 INVALID_CURSOR
    const urlC = `http://127.0.0.1:${portC}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const resC = await fetch(`${urlC}?limit=2&cursor=${encodeURIComponent(dataA.nextCursor!)}`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": pubAId,
      },
    });
    expect(resC.status).toBe(400);
    const errorBody = (await resC.json()) as { errors: Array<{ code: string }> };
    expect(errorBody.errors[0]?.code).toBe("INVALID_CURSOR");

    // Clean up Replica C gracefully
    await terminateProcessGracefully(procC);
    procC = null;
  }, 45000); // Replica C cold startup may exceed Vitest's 5s default on CI.

  it("Scenario F: Release digest isolation rejects unadmitted releases", async () => {
    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/nonexistent-plugin/resources/course-records`;
    const resNotFound = await fetch(`${urlA}?limit=2`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": pubAId,
      },
    });
    expect(resNotFound.status).toBe(404);
  });

  it("Scenario G: Concurrent writes via Replica A and Replica B enforce CAS version consistency", async () => {
    const urlA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/v1/courses`;
    const urlB = `http://127.0.0.1:${portB}/api/admin/v1/extensions/${manifest.id}/v1/courses`;

    const headersA = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
      "Content-Type": "application/json",
      Origin: `http://localhost:${portA}`,
    };

    const headersB = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
      "Content-Type": "application/json",
      Origin: `http://localhost:${portB}`,
    };

    // Read current version of course-a-01
    const resourceUrl = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const getRes = await fetch(`${resourceUrl}?limit=1`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": pubAId,
      },
    });
    const currentList = (await getRes.json()) as { items: Array<{ id: string; version: number }> };
    const currentCourse = currentList.items.find((c) => c.id === "course-a-01")!;
    const expectedVersion = currentCourse.version;

    // Send competing updates simultaneously to Replica A and Replica B with identical expectedVersion
    const updatePayloadA = {
      operation: "save",
      courseId: "course-a-01",
      expectedVersion,
      title_en: "Updated by Replica A",
      title_ar: "تحديث من نسخة أ",
      summary_en: "Alpha summary",
      summary_ar: "ملخص ألفا",
      lesson_title_en: "Alpha lesson",
      lesson_title_ar: "درس ألفا",
      lesson_body_en: "Alpha content",
      lesson_body_ar: "محتوى ألفا",
    };

    const updatePayloadB = {
      operation: "save",
      courseId: "course-a-01",
      expectedVersion,
      title_en: "Updated by Replica B",
      title_ar: "تحديث من نسخة ب",
      summary_en: "Beta summary",
      summary_ar: "ملخص بيتا",
      lesson_title_en: "Beta lesson",
      lesson_title_ar: "درس بيتا",
      lesson_body_en: "Beta content",
      lesson_body_ar: "محتوى بيتا",
    };

    const [resWriteA, resWriteB] = await Promise.all([
      fetch(urlA, { method: "POST", headers: headersA, body: JSON.stringify(updatePayloadA) }),
      fetch(urlB, { method: "POST", headers: headersB, body: JSON.stringify(updatePayloadB) }),
    ]);

    expect(resWriteA.status).toBe(200);
    expect(resWriteB.status).toBe(200);

    const bodyA = (await resWriteA.json()) as { outcome: string; version: number };
    const bodyB = (await resWriteB.json()) as { outcome: string; version: number };

    const outcomes = [bodyA.outcome, bodyB.outcome];
    expect(outcomes).toContain("saved");
    expect(outcomes).toContain("conflict");

    const winner = bodyA.outcome === "saved" ? bodyA : bodyB;
    const loser = bodyA.outcome === "conflict" ? bodyA : bodyB;
    expect(winner.version).toBe(expectedVersion + 1);
    expect(loser.outcome).toBe("conflict");

    // Verify database state: course-a-01 version has incremented exactly once
    const finalRes = await fetch(`${resourceUrl}?limit=1`, {
      headers: {
        Authorization: `Bearer ${staffSessionToken}`,
        Cookie: `vibress_session=${staffSessionToken}`,
        "x-publication-id": pubAId,
      },
    });
    const finalList = (await finalRes.json()) as { items: Array<{ id: string; version: number; fields: { title_en: string } }> };
    const updatedCourse = finalList.items.find((c) => c.id === "course-a-01")!;
    expect(updatedCourse.version).toBe(expectedVersion + 1);

    const expectedWinnerTitle = bodyA.outcome === "saved" ? "Updated by Replica A" : "Updated by Replica B";
    const expectedLoserTitle = bodyA.outcome === "saved" ? "Updated by Replica B" : "Updated by Replica A";
    expect(updatedCourse.fields.title_en).toBe(expectedWinnerTitle);
    expect(updatedCourse.fields.title_en).not.toBe(expectedLoserTitle);
  });
  it("Scenario H: Read-only Native admission and operator rollback across independent replicas", async () => {
    // Replica A/B have independently approved write releases. A third
    // process exercises read-only mode, then an operator-disabled release.
    // This is a disposable *mixed-policy test*, never a recommended fleet
    // configuration: production rollout requires identical replica allowlists.
    const nativePath = `/api/admin/v1/extensions/${manifest.id}/views/course-overview/native`;
    const dataPath = `/api/admin/v1/extensions/${manifest.id}/data`;
    const resourcePath = `/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const headers = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
    };
    const baseA = `http://127.0.0.1:${portA}`;
    const baseB = `http://127.0.0.1:${portB}`;
    const baseC = `http://127.0.0.1:${portC}`;

    // Confirm signed admission is independently visible on both original
    // API replicas before comparing the read-only deployment.
    for (const base of [baseA, baseB]) {
      const response = await fetch(base + nativePath, { headers });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        mode: string; routeId?: string;
      };
      expect(body.mode).toBe("native");
      expect(body.routeId).toBe("courses");
    }

    try {
      procC = spawnReplicaProcess(
        portC, disposableDbUrl, sharedSecret,
        lockfilePath, keyPath, sigPath, approvedReleaseTag,
        [portA, portB, portC], "", // Explicitly deny Native writes.
      );
      await waitForHealthy(baseC + "/health/live");

      const readOnlyResponse = await fetch(baseC + nativePath, { headers });
      expect(readOnlyResponse.status).toBe(200);
      const readOnlyBody = (await readOnlyResponse.json()) as {
        mode: string; routeId?: string; workflow?: unknown;
      };
      expect(readOnlyBody.mode).toBe("native");
      expect(readOnlyBody.routeId).toBe("courses");
      expect(readOnlyBody.workflow).toBeUndefined();

      const dataResponse = await fetch(baseC + dataPath, { headers });
      expect(dataResponse.status).toBe(200);
      const data = (await dataResponse.json()) as {
        actions: unknown[]; resources: Array<{ id: string }>;
      };
      expect(data.actions).toEqual([]);
      expect(data.resources.some((r) => r.id === "course-records")).toBe(true);

      const recordsResponse = await fetch(baseC + resourcePath + "?limit=2", { headers });
      expect(recordsResponse.status).toBe(200);
      const records = (await recordsResponse.json()) as {
        items: Array<{ id: string }>;
      };
      expect(records.items.map((r) => r.id))
        .toEqual(["course-a-01", "course-a-02"]);

      // Capture complete persisted bilingual fields and row versions BEFORE
      // rollback; this survives earlier concurrent edits from Scenario G.
      const snapshot = async (publicationId: string) => {
        const response = await fetch(baseC + resourcePath + "?limit=10", {
          headers: { ...headers, "x-publication-id": publicationId },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as {
          items: Array<{
            id: string; version: number;
            fields: Record<string, string | number | boolean | null>;
          }>;
        };
      };
      const beforeAlpha = await snapshot(pubAId);
      const beforeBeta = await snapshot(pubBId);
      expect(beforeAlpha.items).toHaveLength(5);
      expect(beforeBeta.items).toHaveLength(2);
      expect(beforeAlpha.items[1]?.fields.title_ar).toBe("دورة ألفا 2");
      expect(beforeBeta.items[0]?.fields.title_ar).toBe("دورة بيتا 1");

      // The same read-only release cannot authorize a forged publication.
      const wrongPublication = await fetch(baseC + nativePath, {
        headers: { ...headers, "x-publication-id": "unknown-foreign-publication" },
      });
      expect(wrongPublication.status).toBe(403);

      // Operators disable Native by removing the exact approved digest
      // from every serving replica and restarting it. The Host may advertise
      // explicit legacy mode, but the *already-open* Native browser view
      // must clear its data and not silently switch to an iframe.
      await terminateProcessGracefully(procC);
      procC = null;
      procC = spawnReplicaProcess(
        portC, disposableDbUrl, sharedSecret,
        lockfilePath, keyPath, sigPath, "",
        [portA, portB, portC], "",
      );
      await waitForHealthy(baseC + "/health/live");

      const disabled = await fetch(baseC + nativePath, { headers });
      expect(disabled.status).toBe(200);
      expect(await disabled.json()).toEqual({ mode: "legacy" });

      const disabledData = await fetch(baseC + dataPath, { headers });
      expect(disabledData.status).toBe(404);
      const disabledRecords = await fetch(baseC + resourcePath + "?limit=2", { headers });
      expect(disabledRecords.status).toBe(404);

      // Restore the SAME signed, reviewed read-only release without running
      // migrations or resetting the existing PostgreSQL database. A release
      // rollback changes admission, not durable plugin-owned content.
      await terminateProcessGracefully(procC);
      procC = null;
      procC = spawnReplicaProcess(
        portC, disposableDbUrl, sharedSecret,
        lockfilePath, keyPath, sigPath, approvedReleaseTag,
        [portA, portB, portC], "",
      );
      await waitForHealthy(baseC + "/health/live");

      const readmitted = await fetch(baseC + nativePath, { headers });
      expect(readmitted.status).toBe(200);
      const readmittedBody = (await readmitted.json()) as {
        mode: string; workflow?: unknown;
      };
      expect(readmittedBody.mode).toBe("native");
      expect(readmittedBody.workflow).toBeUndefined();
      expect(await snapshot(pubAId)).toEqual(beforeAlpha);
      expect(await snapshot(pubBId)).toEqual(beforeBeta);
      const stillForbidden = await fetch(baseC + resourcePath + "?limit=2", {
        headers: { ...headers, "x-publication-id": "unknown-foreign-publication" },
      });
      expect(stillForbidden.status).toBe(403);
    } finally {
      await terminateProcessGracefully(procC);
      procC = null;
    }
  }, 90000);

  it("Scenario I: Running migrations again on a populated installation preserves plugin data", async () => {
    const baseA = `http://127.0.0.1:${portA}/api/admin/v1/extensions/${manifest.id}/resources/course-records?limit=20`;
    const baseB = `http://127.0.0.1:${portB}/api/admin/v1/extensions/${manifest.id}/resources/course-records?limit=20`;
    const baseHeaders = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
    };
    const headersA = { ...baseHeaders, "x-publication-id": pubAId };
    const headersB = { ...baseHeaders, "x-publication-id": pubBId };
    const read = async (url: string, headers: typeof headersA) => {
      const response = await fetch(url, { headers });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        items: Array<{
          id: string; version: number;
          fields: Record<string, string | number | boolean | null>;
        }>;
      };
    };
    const [originalA, originalB] = await Promise.all([
      read(baseA, headersA),
      read(baseB, headersB),
    ]);
    expect(originalA.items).toHaveLength(5);
    expect(originalB.items).toHaveLength(2);
    // Scenario G updates course-a-01; use the actual pre-migration snapshot
    // for that record. Verify the untouched second Arabic row explicitly.
    expect(originalA.items[1]?.fields.title_ar).toBe("دورة ألفا 2");
    expect(originalB.items[0]?.fields.title_ar).toBe("دورة بيتا 1");

    const modelBefore = await getDb().select().from(pluginPhysicalModels)
      .where(eq(pluginPhysicalModels.pluginId, registeredPluginId));
    expect(modelBefore.length).toBeGreaterThan(0);

    // Model an existing installation: run the same forward migrator with
    // real bilingual content, physical plugin models, sessions and two API
    // processes already present. Never rewind or edit released migrations.
    await runMigrations();

    const [afterA, afterB] = await Promise.all([
      read(baseB, headersA),
      read(baseA, headersB),
    ]);
    expect(afterA).toEqual(originalA);
    expect(afterB).toEqual(originalB);
    const modelAfter = await getDb().select().from(pluginPhysicalModels)
      .where(eq(pluginPhysicalModels.pluginId, registeredPluginId));
    expect(modelAfter).toEqual(modelBefore);

    // Unknown tenant selector must remain denied after upgrade replay.
    const forged = await fetch(baseA, {
      headers: { ...headersA, "x-publication-id": "other-tenant" },
    });
    expect(forged.status).toBe(403);
  }, 45000);

});
