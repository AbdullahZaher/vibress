// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, copyFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  getDb,
  getDbPool,
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
  inArray,
} from "@vibress/database";
import { hashToken, generateOpaqueToken } from "@vibress/security";
import { buildApp } from "../../apps/api/src/main";
import { pluginsService, workspaceService, publicationLocaleService } from "../../apps/api/src/services";
import {
  PluginPhysicalSchemaMigrationService,
  DrizzlePluginStorageMigrationRepository,
  assertPluginRestoreReadiness,
  verifyTrustedPluginRelease,
} from "@vibress/plugins";
import { readVerifiedOperatorMigrationPlan } from "../../scripts/plugins/read-verified-migration-plan";

describe("EXT-506: Real Vibress LMS Installation & Production Integration", () => {
  const lmsDir =
    process.env.VIBRESS_LMS_DIR ||
    path.resolve(process.cwd(), "../vibress-lms");
  const releaseDir = path.join(lmsDir, "dist", "pilot-release");

  let tempDir: string;
  let lockfilePath: string;
  let planPath: string;
  let artifactPath: string;
  let keyPath: string;
  let sigPath: string;
  let app: ReturnType<typeof buildApp>;
  let serverPort: number;

  const runId = randomUUID().slice(0, 8);
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
  let manifest: any;

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // 1. Ensure the real LMS artifact is built and released
    const artifactSrc = path.join(releaseDir, "vibress-lms-pilot.mjs");
    if (!existsSync(artifactSrc)) {
      execSync("npm run release:pilot", { cwd: lmsDir, stdio: "inherit" });
    }

    // 2. Stage into an operator release directory
    tempDir = await mkdtemp(path.join(tmpdir(), "vibress-ext506-lms-"));
    artifactPath = path.join(tempDir, "vibress-lms-pilot.mjs");
    planPath = path.join(tempDir, "operator-migration-plan.json");
    lockfilePath = path.join(tempDir, "trusted-plugins.json");
    keyPath = path.join(tempDir, "operator-public.pem");
    sigPath = path.join(tempDir, "operator.sig");

    await copyFile(artifactSrc, artifactPath);
    await copyFile(path.join(releaseDir, "operator-migration-plan.json"), planPath);
    await copyFile(path.join(releaseDir, "trusted-plugins.json"), lockfilePath);

    // 3. Generate Ed25519 signing keypair and sign lockfile
    const lockBytes = await readFile(lockfilePath);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    await writeFile(keyPath, publicKey.export({ format: "pem", type: "spki" }));
    await writeFile(sigPath, sign(null, lockBytes, privateKey).toString("base64") + "\n");

    // 4. Configure environment
    process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE = lockfilePath;
    process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE = "1";
    process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE = keyPath;
    process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE = sigPath;
    process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE = "0";

    const lockData = JSON.parse(lockBytes.toString("utf8"));
    manifest = lockData.plugins[0].manifest;
  }, 60000);

  afterAll(async () => {
    // Close Fastify server
    if (app) {
      await app.close();
    }

    // Database cleanup
    const db = getDb();
    try {
      if (registeredPluginId) {
        await db
          .delete(pluginPublicationStates)
          .where(eq(pluginPublicationStates.pluginId, registeredPluginId));
      }
      await db
        .delete(memberSessions)
        .where(inArray(memberSessions.memberId, [memberA1Id, memberA2Id, memberB1Id]));
      await db
        .delete(members)
        .where(inArray(members.id, [memberA1Id, memberA2Id, memberB1Id]));
      await db
        .delete(publicationLocales)
        .where(inArray(publicationLocales.publicationId, [pubAId, pubBId]));
      await db
        .delete(publications)
        .where(inArray(publications.id, [pubAId, pubBId]));
    } catch {
      // Ignore teardown errors
    }

    // Restore environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    // Remove temp directory
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

    // 1. Locate existing or register new plugin (must be in registered/inactive status for migration)
    let pluginId: string;
    const [existing] = await db
      .select()
      .from(plugins)
      .where(eq(plugins.manifestId, manifest.id))
      .limit(1);

    if (existing) {
      pluginId = existing.id;
      if (existing.status === "active") {
        await pluginsService.deactivatePlugin(pluginId, "operator-test");
      }
    } else {
      const registered = await pluginsService.registerPlugin(manifest, "operator-test");
      expect(registered.manifestId).toBe("vibress-lms-pilot");
      expect(registered.status).toBe("registered");
      pluginId = registered.id;
    }
    registeredPluginId = pluginId;

    // 2. Apply approved physical migration plan
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const migrator = new PluginPhysicalSchemaMigrationService(
      new DrizzlePluginStorageMigrationRepository(() => db),
    );

    // First apply -> applied (or already_applied if ledger persisted)
    const firstResult = await migrator.applyApprovedPhysical(approvedPlan);
    expect(["applied", "already_applied"]).toContain(firstResult);

    // Second apply -> already_applied (idempotent)
    const secondResult = await migrator.applyApprovedPhysical(approvedPlan);
    expect(secondResult).toBe("already_applied");

    // Verify physical models catalog in DB
    const models = await db
      .select()
      .from(pluginPhysicalModels)
      .where(eq(pluginPhysicalModels.pluginId, pluginId));
    expect(models.length).toBeGreaterThanOrEqual(2);
    const modelKeys = models.map((m) => m.modelKey);
    expect(modelKeys).toContain("enrollments");
    expect(modelKeys).toContain("completions");

    // 3. Activate plugin
    const activated = await pluginsService.activatePlugin(pluginId, "operator-test");
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
    serverPort = (app.server.address() as any).port;

    const siteA = `http://${domainA}:${serverPort}`;
    const siteB = `http://${domainB}:${serverPort}`;

    // Configure CORS origins so siteA origin is allowed for Member mutations,
    // and cross-origin attempts from siteB to siteA trigger CSRF rejection
    process.env.CORS_ORIGINS = siteA;

    const cookieA1 = `vibress_member_session=${tokenA1}`;
    const cookieA2 = `vibress_member_session=${tokenA2}`;
    const cookieB1 = `vibress_member_session=${tokenB1}`;

    // Import the official live-host acceptance probe from vibress-lms
    const liveHostPath = path.join(lmsDir, "src", "acceptance", "live-host.mjs");
    const { verifyLiveHost } = await import(pathToFileURL(liveHostPath).href);

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

    // HTTP request to Site B's catalog should now fail (503 / 404)
    const siteB = `http://${domainB}:${serverPort}`;
    const catalogUrl = `${siteB}/api/content/v1/extensions/vibress-lms-pilot/views/catalog/page?locale=en`;
    const res = await fetch(catalogUrl, { redirect: "error" });
    expect([403, 404, 503]).toContain(res.status);

    // Data in plugin_member_records must remain intact (no silent data deletion!)
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
    const body = await resRestored.json();
    expect(body?.data?.outcome).toBe("published");
  });

  it("Step 6: confirms backup and restore readiness of the installed release", async () => {
    const db = getDb();
    const approved = await verifyTrustedPluginRelease(lockfilePath);
    expect(approved.length).toBe(1);
    expect(approved[0].pluginId).toBe("vibress-lms-pilot");

    const enabled = await db
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

    // assertPluginRestoreReadiness checks that enabled installations match verified lockfile
    expect(() => assertPluginRestoreReadiness(enabled, [], approved)).not.toThrow();
  });
});
