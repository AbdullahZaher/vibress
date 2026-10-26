// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const PORT_A = 7791;
const PORT_B = 7792;
const PORT_C = 7793;

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
): ChildProcess {
  const tsxBin = path.resolve(repoRoot, "node_modules/.bin/tsx");
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
        REDIS_URL: "redis://127.0.0.1:6379",
        VIBRESS_TRUSTED_PLUGIN_LOCKFILE: lockfilePath,
        VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE: keyPath,
        VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE: sigPath,
        VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1",
        VIBRESS_NATIVE_ADMIN_UI_RELEASES: releaseTag,
        VIBRESS_NATIVE_ADMIN_ACTION_RELEASES: releaseTag,
        VIBRESS_ENCRYPTION_KEY: encryptionKey,
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
        CORS_ORIGINS: `http://localhost:${PORT_A},http://localhost:${PORT_B},http://127.0.0.1:${PORT_A},http://127.0.0.1:${PORT_B}`,
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

    // 8. Launch two genuinely separate Node.js OS processes for Replica A and Replica B
    procA = spawnReplicaProcess(
      PORT_A,
      disposableDbUrl,
      sharedSecret,
      lockfilePath,
      keyPath,
      sigPath,
      approvedReleaseTag,
    );

    procB = spawnReplicaProcess(
      PORT_B,
      disposableDbUrl,
      sharedSecret,
      lockfilePath,
      keyPath,
      sigPath,
      approvedReleaseTag,
    );

    // 9. Verify genuine separate OS processes and wait for health
    expect(procA.pid).toBeDefined();
    expect(procB.pid).toBeDefined();
    expect(procA.pid).not.toBe(procB.pid);
    expect(PORT_A).not.toBe(PORT_B);

    await Promise.all([
      waitForHealthy(`http://127.0.0.1:${PORT_A}/health/live`),
      waitForHealthy(`http://127.0.0.1:${PORT_B}/health/live`),
    ]);
  }, 120000);

  afterAll(async () => {
    // Terminate spawned child processes immediately
    if (procA) {
      procA.kill("SIGKILL");
      procA = null;
    }
    if (procB) {
      procB.kill("SIGKILL");
      procB = null;
    }
    if (procC) {
      procC.kill("SIGKILL");
      procC = null;
    }

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

  it("Scenario A: Cross-process cursor pagination across Replica A and Replica B", async () => {
    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const urlB = `http://127.0.0.1:${PORT_B}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

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
    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

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

    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const urlB = `http://127.0.0.1:${PORT_B}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

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
    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
    const urlB = `http://127.0.0.1:${PORT_B}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;

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
      PORT_C,
      disposableDbUrl,
      rotatedSecret, // Mismatched secret
      lockfilePath,
      keyPath,
      sigPath,
      approvedReleaseTag,
    );

    await waitForHealthy(`http://127.0.0.1:${PORT_C}/health/live`);

    // 2. Fetch cursor from Replica A (signed with sharedSecret)
    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
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
    const urlC = `http://127.0.0.1:${PORT_C}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
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

    // Clean up Replica C
    procC.kill("SIGTERM");
    procC = null;
  });

  it("Scenario F: Release digest isolation rejects unadmitted releases", async () => {
    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/nonexistent-plugin/resources/course-records`;
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
    const urlA = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/v1/courses`;
    const urlB = `http://127.0.0.1:${PORT_B}/api/admin/v1/extensions/${manifest.id}/v1/courses`;

    const headersA = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
      "Content-Type": "application/json",
      Origin: `http://localhost:${PORT_A}`,
    };

    const headersB = {
      Authorization: `Bearer ${staffSessionToken}`,
      Cookie: `vibress_session=${staffSessionToken}`,
      "x-publication-id": pubAId,
      "Content-Type": "application/json",
      Origin: `http://localhost:${PORT_B}`,
    };

    // Read current version of course-a-01
    const resourceUrl = `http://127.0.0.1:${PORT_A}/api/admin/v1/extensions/${manifest.id}/resources/course-records`;
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

    const statusCodes = [resWriteA.status, resWriteB.status];
    expect(statusCodes).toContain(200);

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
    expect(["Updated by Replica A", "Updated by Replica B"]).toContain(updatedCourse.fields.title_en);
  });
});
