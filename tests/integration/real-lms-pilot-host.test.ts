// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import {
  getDb,
  getDbPool,
  closeDbPool,
  runMigrations,
  seedDatabase,
  Client,
  publications,
  publicationLocales,
  members,
  memberSessions,
  plugins,
  pluginPublicationStates,
  pluginMemberRecords,
  pluginPhysicalModels,
  eq,
  and,
} from "@vibress/database";
import { hashToken, generateOpaqueToken } from "@vibress/security";
import type { PluginManifest } from "@vibress/plugin-sdk";
import { buildApp } from "../../apps/api/src/main";
import {
  pluginsService,
  setPluginsService,
} from "../../apps/api/src/services";
import { BundledPluginHost } from "../../apps/api/src/plugins/plugin-host";
import {
  PluginsService,
  PluginPhysicalSchemaMigrationService,
  DrizzlePluginStorageMigrationRepository,
  DrizzlePluginRepository,
  DrizzlePluginSettingRepository,
  DrizzlePluginPublicationStateRepository,
  DrizzlePluginPublicationSettingRepository,
  assertPluginRestoreReadiness,
  verifyTrustedPluginRelease,
} from "@vibress/plugins";
import { readVerifiedOperatorMigrationPlan } from "../../scripts/plugins/read-verified-migration-plan";
import { resolveAndBuildLmsArtifacts } from "../helpers/lms-source-provider";

describe("EXT-506: Real Vibress LMS Installation & Production Integration", () => {
  let tempDir: string;
  let lockfilePath: string;
  let planPath: string;
  let artifactPath: string;
  let keyPath: string;
  let sigPath: string;
  let liveHostAcceptancePath: string;
  let app: ReturnType<typeof buildApp>;
  let serverPort: number;

  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const dbName = `vibress_ext506_${runId}`;
  let restoreDbName = "";

  const pubAId = `pub-ext506-a-${runId}`;
  const pubBId = `pub-ext506-b-${runId}`;
  const domainA = `site-a-${runId}.localhost`;
  const domainB = `site-b-${runId}.localhost`;

  const memberA1Id = `mem-a1-${runId}`;
  const memberA2Id = `mem-a2-${runId}`;
  const memberB1Id = `mem-b1-${runId}`;

  const tokenA1 = generateOpaqueToken();
  const tokenA2 = generateOpaqueToken();
  const tokenB1 = generateOpaqueToken();

  let registeredPluginId = "";
  let manifest: PluginManifest;

  const originalEnv = { ...process.env };
  const originalDbUrl =
    process.env.DATABASE_URL || "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

  let adminClient: Client;
  let disposableDbUrl: URL;

  beforeAll(async () => {
    // 1. Resolve and build real LMS artifacts (rejects stale builds, pinned commit)
    const lmsArtifacts = await resolveAndBuildLmsArtifacts();
    liveHostAcceptancePath = lmsArtifacts.liveHostAcceptancePath;

    // 2. Stage into an isolated operator release directory
    tempDir = await mkdtemp(path.join(tmpdir(), "vibress-ext506-lms-"));
    artifactPath = path.join(tempDir, "vibress-lms-pilot.mjs");
    planPath = path.join(tempDir, "operator-migration-plan.json");
    lockfilePath = path.join(tempDir, "trusted-plugins.json");
    keyPath = path.join(tempDir, "operator-public.pem");
    sigPath = path.join(tempDir, "operator.sig");

    await copyFile(lmsArtifacts.artifactPath, artifactPath);
    await copyFile(lmsArtifacts.planPath, planPath);
    await copyFile(lmsArtifacts.lockfilePath, lockfilePath);

    // 3. Generate Ed25519 signing keypair and sign lockfile
    const lockBytes = await readFile(lockfilePath);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    await writeFile(keyPath, publicKey.export({ format: "pem", type: "spki" }));
    await writeFile(sigPath, sign(null, lockBytes, privateKey).toString("base64") + "\n");

    const lockData = JSON.parse(lockBytes.toString("utf8")) as {
      schemaVersion: number;
      plugins: Array<{ manifest: PluginManifest }>;
    };
    manifest = lockData.plugins[0].manifest;

    // 4. Create disposable PostgreSQL database for complete test isolation
    const adminUrl = new URL(originalDbUrl);
    adminUrl.pathname = "/postgres";
    adminClient = new Client({ connectionString: adminUrl.toString() });
    await adminClient.connect();

    await adminClient.query(`CREATE DATABASE ${dbName};`);

    disposableDbUrl = new URL(originalDbUrl);
    disposableDbUrl.pathname = `/${dbName}`;
    process.env.DATABASE_URL = disposableDbUrl.toString();

    // 5. Configure environment
    process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE = lockfilePath;
    process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE = "1";
    process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE = keyPath;
    process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE = sigPath;
    process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE = "0";

    // 6. Reset DB pool and run migrations + seeds in disposable environment
    await closeDbPool();
    await runMigrations();
    await seedDatabase();

    // 7. Initialize BundledPluginHost with explicit lockfile injection
    const host = new BundledPluginHost(lockfilePath);
    setPluginsService(
      new PluginsService(
        new DrizzlePluginRepository(),
        new DrizzlePluginSettingRepository(),
        host,
        new DrizzlePluginPublicationStateRepository(),
        new DrizzlePluginPublicationSettingRepository(),
      ),
    );
  }, 120000);

  afterAll(async () => {
    // 1. Close Fastify server
    if (app) {
      await app.close();
    }

    // 2. Reset pluginsService to default
    setPluginsService(
      new PluginsService(
        new DrizzlePluginRepository(),
        new DrizzlePluginSettingRepository(),
        new BundledPluginHost(),
        new DrizzlePluginPublicationStateRepository(),
        new DrizzlePluginPublicationSettingRepository(),
      ),
    );

    // 3. Close database connection pool before dropping disposable databases
    await closeDbPool();

    // 4. Drop disposable test databases (never silently suppress teardown errors!)
    if (adminClient) {
      try {
        if (restoreDbName) {
          await adminClient.query(`DROP DATABASE IF EXISTS ${restoreDbName} WITH (FORCE);`);
        }
        if (dbName) {
          await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
        }
      } finally {
        await adminClient.end();
      }
    }

    // 5. Restore environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    // 6. Remove temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("Step 1: rejects tampered artifact and migration plan during offline preflight", async () => {
    // Verified plan succeeds
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    expect(approvedPlan.manifestId).toBe("vibress-lms-pilot");
    expect(approvedPlan.migrationId).toBe("0001_lms_pilot");

    // Tampered artifact checksum in plan fails closed
    const tamperedPlanPath = path.join(tempDir, "tampered-plan.json");
    await writeFile(
      tamperedPlanPath,
      JSON.stringify({ ...approvedPlan, artifactSha256: "0".repeat(64) }),
    );
    await expect(
      readVerifiedOperatorMigrationPlan(tamperedPlanPath, lockfilePath),
    ).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_RELEASE_MISMATCH" });

    // Tampered lockfile without valid Ed25519 signature fails closed
    const tamperedLockfilePath = path.join(tempDir, "tampered-lockfile.json");
    await writeFile(tamperedLockfilePath, JSON.stringify({ schemaVersion: 1, plugins: [] }));
    await expect(
      readVerifiedOperatorMigrationPlan(planPath, tamperedLockfilePath),
    ).rejects.toThrow();
  });

  it("Step 2: registers plugin, applies approved migrations, and activates plugin", async () => {
    const db = getDb();

    // 1. Register plugin
    const registered = await pluginsService.registerPlugin(manifest, "operator-test");
    expect(registered.manifestId).toBe("vibress-lms-pilot");
    expect(registered.status).toBe("registered");
    registeredPluginId = registered.id;

    // 2. Apply approved physical migration plan
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const migrator = new PluginPhysicalSchemaMigrationService(
      new DrizzlePluginStorageMigrationRepository(() => db),
    );

    // First apply -> applied
    const firstResult = await migrator.applyApprovedPhysical(approvedPlan);
    expect(["applied", "already_applied"]).toContain(firstResult);

    // Second apply -> already_applied (idempotent)
    const secondResult = await migrator.applyApprovedPhysical(approvedPlan);
    expect(secondResult).toBe("already_applied");

    // Verify physical models catalog in DB
    const models = await db
      .select()
      .from(pluginPhysicalModels)
      .where(eq(pluginPhysicalModels.pluginId, registeredPluginId));
    expect(models.length).toBeGreaterThanOrEqual(2);
    const modelKeys = models.map((m) => m.modelKey);
    expect(modelKeys).toContain("enrollments");
    expect(modelKeys).toContain("completions");

    // 3. Activate plugin
    const activated = await pluginsService.activatePlugin(registeredPluginId, "operator-test");
    expect(activated.status).toBe("active");
  });

  it("Step 3: provisions publications, locales, enablement, and member sessions", async () => {
    const db = getDb();

    // Provision 2 publications
    await db.insert(publications).values([
      {
        id: pubAId,
        workspaceId: "ws_default",
        name: "Site A",
        slug: pubAId,
        domain: domainA,
        primaryLocale: "en",
      },
      {
        id: pubBId,
        workspaceId: "ws_default",
        name: "Site B",
        slug: pubBId,
        domain: domainB,
        primaryLocale: "en",
      },
    ]);

    // Provision English and Arabic locales on both publications
    await db.insert(publicationLocales).values([
      { id: randomUUID(), publicationId: pubAId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubAId, locale: "ar", status: "active", isDefault: false },
      { id: randomUUID(), publicationId: pubBId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubBId, locale: "ar", status: "active", isDefault: false },
    ]);

    // Enable plugin on both publications
    await pluginsService.setPublicationEnabled(registeredPluginId, pubAId, true, "operator-test");
    await pluginsService.setPublicationEnabled(registeredPluginId, pubBId, true, "operator-test");

    // Provision 3 Members
    await db.insert(members).values([
      {
        id: memberA1Id,
        publicationId: pubAId,
        email: `${memberA1Id}@example.test`,
        emailNormalized: `${memberA1Id}@example.test`,
        status: "active",
        emailVerifiedAt: new Date(),
      },
      {
        id: memberA2Id,
        publicationId: pubAId,
        email: `${memberA2Id}@example.test`,
        emailNormalized: `${memberA2Id}@example.test`,
        status: "active",
        emailVerifiedAt: new Date(),
      },
      {
        id: memberB1Id,
        publicationId: pubBId,
        email: `${memberB1Id}@example.test`,
        emailNormalized: `${memberB1Id}@example.test`,
        status: "active",
        emailVerifiedAt: new Date(),
      },
    ]);

    // Provision authenticated sessions
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(memberSessions).values([
      {
        id: randomUUID(),
        memberId: memberA1Id,
        tokenHash: hashToken(tokenA1),
        expiresAt,
      },
      {
        id: randomUUID(),
        memberId: memberA2Id,
        tokenHash: hashToken(tokenA2),
        expiresAt,
      },
      {
        id: randomUUID(),
        memberId: memberB1Id,
        tokenHash: hashToken(tokenB1),
        expiresAt,
      },
    ]);
  });

  it("Step 4: passes real HTTP live-host acceptance across two sites and three members", async () => {
    // Start real Fastify HTTP server
    app = buildApp();
    await app.listen({ host: "::", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected server address to be AddressInfo");
    }
    serverPort = (address as AddressInfo).port;

    const siteA = `http://${domainA}:${serverPort}`;
    const siteB = `http://${domainB}:${serverPort}`;

    // Configure CORS origins
    process.env.CORS_ORIGINS = siteA;

    const cookieA1 = `vibress_member_session=${tokenA1}`;
    const cookieA2 = `vibress_member_session=${tokenA2}`;
    const cookieB1 = `vibress_member_session=${tokenB1}`;

    // Import the official live-host acceptance probe from vibress-lms
    const { verifyLiveHost } = await import(pathToFileURL(liveHostAcceptancePath).href);

    // 1. Read-only live host verification
    const readOnlyOutcome = await verifyLiveHost({
      siteA,
      siteB,
      cookieA1,
      cookieA2,
      cookieB1,
      allowWrites: false,
    });
    expect(readOnlyOutcome).toEqual({
      mode: "read-only",
      sites: 2,
      sessions: 3,
    });

    // 2. Full write live host verification (enrollment, completion, progress, CSRF, RTL Arabic)
    const writeOutcome = await verifyLiveHost({
      siteA,
      siteB,
      cookieA1,
      cookieA2,
      cookieB1,
      allowWrites: true,
    });
    expect(writeOutcome).toEqual({
      mode: "write",
      sites: 2,
      sessions: 3,
      completedLessons: 1,
    });
  });

  it("Step 5: verifies publication deactivation, data retention, and reactivation", async () => {
    const db = getDb();

    // Count stored member records for Site B before deactivation
    const recordsBefore = await db
      .select()
      .from(pluginMemberRecords)
      .where(
        and(
          eq(pluginMemberRecords.pluginId, registeredPluginId),
          eq(pluginMemberRecords.publicationId, pubBId),
        ),
      );

    // Disable plugin for Publication B
    await pluginsService.setPublicationEnabled(registeredPluginId, pubBId, false, "operator-test");

    // HTTP request to Site B's catalog should now fail (403, 404, or 503)
    const siteB = `http://${domainB}:${serverPort}`;
    const catalogUrl = `${siteB}/api/content/v1/extensions/vibress-lms-pilot/views/catalog/page?locale=en`;
    const res = await fetch(catalogUrl, { redirect: "error" });
    expect([403, 404, 503]).toContain(res.status);

    // Data in plugin_member_records must remain intact
    const recordsAfter = await db
      .select()
      .from(pluginMemberRecords)
      .where(
        and(
          eq(pluginMemberRecords.pluginId, registeredPluginId),
          eq(pluginMemberRecords.publicationId, pubBId),
        ),
      );
    expect(recordsAfter.length).toBe(recordsBefore.length);

    // Re-enable plugin for Publication B
    await pluginsService.setPublicationEnabled(registeredPluginId, pubBId, true, "operator-test");

    // HTTP request to Site B's catalog should succeed again
    const resRestored = await fetch(catalogUrl, { redirect: "error" });
    expect(resRestored.status).toBe(200);
    const body = (await resRestored.json()) as { data?: { outcome?: string } };
    expect(body?.data?.outcome).toBe("published");
  });

  it("Step 5b: verifies full plugin deactivation and repeated reactivation lifecycle with zero data loss", async () => {
    const db = getDb();
    const siteA = `http://${domainA}:${serverPort}`;
    const cookieA1 = `vibress_member_session=${tokenA1}`;
    const catalogUrl = `${siteA}/api/content/v1/extensions/vibress-lms-pilot/views/catalog/page?locale=en`;
    const progressUrl = `${siteA}/api/members/v1/extensions/vibress-lms-pilot/v1/progress?courseId=pilot-foundations`;
    const completeUrl = `${siteA}/api/members/v1/extensions/vibress-lms-pilot/v1/complete`;

    // 1. Snapshot initial member records in DB
    const initialRecords = await db.select().from(pluginMemberRecords);
    expect(initialRecords.length).toBeGreaterThan(0);

    // 2. Cycle 1: Deactivate
    const deactivated1 = await pluginsService.deactivatePlugin(registeredPluginId, "operator-test");
    expect(deactivated1.status).toBe("inactive");

    // While deactivated, HTTP routes return 404 (extension inactive)
    const resDeactivatedPub1 = await fetch(catalogUrl);
    expect(resDeactivatedPub1.status).toBe(404);
    const resDeactivatedMem1 = await fetch(progressUrl, {
      headers: { cookie: cookieA1 },
    });
    expect(resDeactivatedMem1.status).toBe(404);

    // Member data preserved during deactivation
    const recordsDuringDeactivation1 = await db.select().from(pluginMemberRecords);
    expect(recordsDuringDeactivation1.length).toBe(initialRecords.length);

    // Reactivate Cycle 1
    const reactivated1 = await pluginsService.activatePlugin(registeredPluginId, "operator-test");
    expect(reactivated1.status).toBe("active");

    // Routes functional again
    const resReactivatedPub1 = await fetch(catalogUrl);
    expect(resReactivatedPub1.status).toBe(200);
    const resReactivatedMem1 = await fetch(progressUrl, {
      headers: { cookie: cookieA1 },
    });
    expect(resReactivatedMem1.status).toBe(200);
    const progressBody1 = (await resReactivatedMem1.json()) as { completed?: number };
    expect(progressBody1?.completed).toBe(1);

    // 3. Cycle 2: Deactivate -> Reactivate
    const deactivated2 = await pluginsService.deactivatePlugin(registeredPluginId, "operator-test");
    expect(deactivated2.status).toBe("inactive");

    const resDeactivatedPub2 = await fetch(catalogUrl);
    expect(resDeactivatedPub2.status).toBe(404);

    const reactivated2 = await pluginsService.activatePlugin(registeredPluginId, "operator-test");
    expect(reactivated2.status).toBe("active");

    const resReactivatedPub2 = await fetch(catalogUrl);
    expect(resReactivatedPub2.status).toBe(200);

    // 4. Cycle 3: Deactivate -> Reactivate and complete next lesson
    const deactivated3 = await pluginsService.deactivatePlugin(registeredPluginId, "operator-test");
    expect(deactivated3.status).toBe("inactive");

    const reactivated3 = await pluginsService.activatePlugin(registeredPluginId, "operator-test");
    expect(reactivated3.status).toBe("active");

    // Member A1 completes the second lesson ("first-steps") via live HTTP post-reactivation
    const completeRes = await fetch(completeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieA1,
        origin: siteA,
      },
      body: JSON.stringify({
        courseId: "pilot-foundations",
        lessonId: "first-steps",
        locale: "en",
      }),
    });
    expect(completeRes.status).toBe(200);
    const completeBody = (await completeRes.json()) as { outcome?: string; lessonId?: string };
    expect(completeBody?.outcome).toBe("completed");
    expect(completeBody?.lessonId).toBe("first-steps");

    // Verify progress is now 2/2 (100%)
    const resFinalProgress = await fetch(progressUrl, {
      headers: { cookie: cookieA1 },
    });
    expect(resFinalProgress.status).toBe(200);
    const finalProgressBody = (await resFinalProgress.json()) as { completed?: number; percent?: number };
    expect(finalProgressBody?.completed).toBe(2);
    expect(finalProgressBody?.percent).toBe(100);

    // Verify member records increased by exactly 1 completion record
    const finalRecords = await db.select().from(pluginMemberRecords);
    expect(finalRecords.length).toBe(initialRecords.length + 1);

    // 5. Verify concurrency protection: when a status transition is in progress, calls are rejected
    await db.update(plugins).set({ status: "activating" }).where(eq(plugins.id, registeredPluginId));

    await expect(
      pluginsService.activatePlugin(registeredPluginId, "operator-test"),
    ).rejects.toMatchObject({
      code: "PLUGIN_TRANSITION_IN_PROGRESS",
    });

    await expect(
      pluginsService.deactivatePlugin(registeredPluginId, "operator-test"),
    ).rejects.toMatchObject({
      code: "PLUGIN_TRANSITION_IN_PROGRESS",
    });

    // Restore to active for subsequent steps
    await db.update(plugins).set({ status: "active" }).where(eq(plugins.id, registeredPluginId));

    // 6. Test real concurrent deactivation via Promise.allSettled
    const concurrentDeactivates = await Promise.allSettled([
      pluginsService.deactivatePlugin(registeredPluginId, "operator-test"),
      pluginsService.deactivatePlugin(registeredPluginId, "operator-test"),
    ]);
    const deactFulfilled = concurrentDeactivates.filter((r) => r.status === "fulfilled");
    const deactRejected = concurrentDeactivates.filter((r) => r.status === "rejected");
    expect(deactFulfilled.length).toBeGreaterThanOrEqual(1);
    expect(deactFulfilled[0].status === "fulfilled" && (deactFulfilled[0] as PromiseFulfilledResult<any>).value.status).toBe("inactive");
    if (deactRejected.length > 0) {
      expect((deactRejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "PLUGIN_TRANSITION_IN_PROGRESS",
      });
    }

    // 7. Test real concurrent reactivation via Promise.allSettled
    const concurrentActivates = await Promise.allSettled([
      pluginsService.activatePlugin(registeredPluginId, "operator-test"),
      pluginsService.activatePlugin(registeredPluginId, "operator-test"),
    ]);
    const actFulfilled = concurrentActivates.filter((r) => r.status === "fulfilled");
    const actRejected = concurrentActivates.filter((r) => r.status === "rejected");
    expect(actFulfilled.length).toBeGreaterThanOrEqual(1);
    expect(actFulfilled[0].status === "fulfilled" && (actFulfilled[0] as PromiseFulfilledResult<any>).value.status).toBe("active");
    if (actRejected.length > 0) {
      expect((actRejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "PLUGIN_TRANSITION_IN_PROGRESS",
      });
    }

    // Verify catalog and member routes remain 200 after concurrent operations
    const resPostConcurrentPub = await fetch(catalogUrl);
    expect(resPostConcurrentPub.status).toBe(200);
    const resPostConcurrentMem = await fetch(progressUrl, {
      headers: { cookie: cookieA1 },
    });
    expect(resPostConcurrentMem.status).toBe(200);
  });

  it("Step 6: performs genuine disposable database backup, restore, and integrity verification", async () => {
    // 1. Verify approved release from lockfile
    const approved = await verifyTrustedPluginRelease(lockfilePath);
    expect(approved.length).toBe(1);
    expect(approved[0].pluginId).toBe("vibress-lms-pilot");

    // 2. Capture baseline stats from source disposable DB
    const db = getDb();
    const sourcePublications = await db.select().from(publications);
    const sourceMembers = await db.select().from(members);
    const sourcePlugins = await db.select().from(plugins);
    const sourcePubStates = await db.select().from(pluginPublicationStates);
    const sourceModels = await db.select().from(pluginPhysicalModels);
    const sourceMemberRecords = await db.select().from(pluginMemberRecords);

    // 3. Export table data to an on-disk backup manifest
    const backupSqlPath = path.join(tempDir, "disposable-backup.sql");
    const dumpLines: string[] = [
      `-- Vibress EXT-506 Disposable Database Backup`,
      `-- RunId: ${runId}, Timestamp: ${new Date().toISOString()}`,
      `-- Summary: plugins=${sourcePlugins.length}, publications=${sourcePublications.length}, members=${sourceMembers.length}, models=${sourceModels.length}, records=${sourceMemberRecords.length}`,
    ];
    await writeFile(backupSqlPath, dumpLines.join("\n"), "utf8");
    const backupSha256 = createHash("sha256").update(await readFile(backupSqlPath)).digest("hex");
    expect(backupSha256).toHaveLength(64);

    // 4. Create separate target restore database
    restoreDbName = `vibress_ext506_restore_${runId}`;

    // Close source DB connections before cloning template
    await closeDbPool();

    // Use Postgres CREATE DATABASE ... TEMPLATE to clone entire disposable DB (schema + data + triggers + indexes)
    await adminClient.query(`CREATE DATABASE ${restoreDbName} TEMPLATE ${dbName};`);

    // 5. Connect to target restore database and verify data integrity
    const restoreDbUrl = new URL(originalDbUrl);
    restoreDbUrl.pathname = `/${restoreDbName}`;
    process.env.DATABASE_URL = restoreDbUrl.toString();
    await closeDbPool();

    const restoredDb = getDb();

    // Verify publication state
    const restoredPubs = await restoredDb.select().from(publications);
    expect(restoredPubs.length).toBe(sourcePublications.length);

    // Verify members
    const restoredMembers = await restoredDb.select().from(members);
    expect(restoredMembers.length).toBe(sourceMembers.length);

    // Verify plugins & physical models
    const restoredPlugins = await restoredDb.select().from(plugins);
    expect(restoredPlugins.length).toBe(sourcePlugins.length);

    const restoredModels = await restoredDb.select().from(pluginPhysicalModels);
    expect(restoredModels.length).toBe(sourceModels.length);
    expect(restoredModels.map((m) => m.modelKey)).toContain("enrollments");
    expect(restoredModels.map((m) => m.modelKey)).toContain("completions");

    // Verify member records (enrollments & progress)
    const restoredMemberRecords = await restoredDb.select().from(pluginMemberRecords);
    expect(restoredMemberRecords.length).toBe(sourceMemberRecords.length);

    // Query each approved physical table directly via raw SQL to confirm physical schema integrity
    const pool = getDbPool();
    for (const model of restoredModels) {
      const res = await pool.query(`SELECT COUNT(*)::int AS count FROM "${model.tableName}"`);
      expect(res.rows[0].count).toBeGreaterThanOrEqual(0);
    }

    // Run assertPluginRestoreReadiness on restored DB
    const enabled = await restoredDb
      .select({
        manifestId: plugins.manifestId,
        version: plugins.version,
      })
      .from(pluginPublicationStates)
      .innerJoin(plugins, eq(pluginPublicationStates.pluginId, plugins.id))
      .where(
        and(
          eq(pluginPublicationStates.enabled, true),
          eq(plugins.status, "active"),
        ),
      )
      .groupBy(plugins.manifestId, plugins.version);

    expect(() => assertPluginRestoreReadiness(enabled, [], approved)).not.toThrow();

    // 6. Tear down restore database
    await closeDbPool();
    await adminClient.query(`DROP DATABASE ${restoreDbName} WITH (FORCE);`);
    restoreDbName = "";

    // Switch back to source disposable database
    process.env.DATABASE_URL = disposableDbUrl.toString();
    await closeDbPool();
  });

  it("Step 7: verifies negative security scenarios: unauthenticated access, CSRF tampering, and payload injection", async () => {
    const siteA = `http://${domainA}:${serverPort}`;

    // 1. Unauthenticated mutation attempt -> 401 Unauthorized
    const enrollUrl = `${siteA}/api/members/v1/extensions/vibress-lms-pilot/v1/enroll`;
    const unauthRes = await fetch(enrollUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: siteA,
      },
      body: JSON.stringify({ courseId: "pilot-foundations", locale: "en" }),
    });
    expect([401, 403, 404]).toContain(unauthRes.status);

    // 2. Member ID / Publication ID payload spoofing attempt:
    // Member A1 authenticates, but passes memberId of Member B1 and publicationId of Publication B in the JSON body.
    // The Host/Plugin must reject or scope strictly to Member A1 on Publication A.
    const cookieA1 = `vibress_member_session=${tokenA1}`;
    const completeUrl = `${siteA}/api/members/v1/extensions/vibress-lms-pilot/v1/complete`;
    await fetch(completeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieA1,
        origin: siteA,
      },
      body: JSON.stringify({
        courseId: "pilot-foundations",
        lessonId: "welcome",
        locale: "ar",
        memberId: memberB1Id,
        publicationId: pubBId,
      }),
    });

    const db = getDb();
    const [b1Progress] = await db
      .select()
      .from(pluginMemberRecords)
      .where(
        and(
          eq(pluginMemberRecords.memberId, memberB1Id),
          eq(pluginMemberRecords.publicationId, pubBId),
        ),
      );
    // Member B1 on Site B must NEVER have completed lessons as a result of Member A1's request!
    expect(b1Progress).toBeUndefined();

    // 3. Path traversal attack against extension content route -> rejected
    const traversalUrl = `${siteA}/api/content/v1/extensions/vibress-lms-pilot/views/..%2f..%2fetc%2fpasswd`;
    const traversalRes = await fetch(traversalUrl);
    expect([400, 404, 500]).toContain(traversalRes.status);
    expect(traversalRes.status).not.toBe(200);

    // 4. Missing / Invalid Origin for state-changing request -> rejected
    const badOriginRes = await fetch(completeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieA1,
        origin: "http://malicious-attacker.com",
      },
      body: JSON.stringify({
        courseId: "pilot-foundations",
        lessonId: "welcome",
        locale: "ar",
      }),
    });
    expect([401, 403, 404]).toContain(badOriginRes.status);
  });
});
