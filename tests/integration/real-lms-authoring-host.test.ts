// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  pluginPhysicalModels,
  eq,
  users,
  userRoles,
  roles,
  sessions,
  publicationMemberships,
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
} from "@vibress/plugins";
import { readVerifiedOperatorMigrationPlan } from "../../scripts/plugins/read-verified-migration-plan";
import { resolveAndBuildLmsAuthoringArtifacts } from "../helpers/lms-source-provider";

describe("LMS-104: Production-Quality Public Course Catalog, Protected Lessons & LMS Integration", () => {
  let tempDir: string;
  let lockfilePath: string;
  let planPath: string;
  let artifactPath: string;
  let keyPath: string;
  let sigPath: string;
  let app: ReturnType<typeof buildApp>;
  let serverPort: number;

  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const dbName = `vibress_lms104_${runId}`;

  const pubAId = `pub-lms104-a-${runId}`;
  const pubBId = `pub-lms104-b-${runId}`;
  const domainA = `site-a-${runId}.localhost`;
  const domainB = `site-b-${runId}.localhost`;

  const memberA1Id = `mem-a1-${runId}`;
  const memberA2Id = `mem-a2-${runId}`;
  const memberB1Id = `mem-b1-${runId}`;

  const tokenA1 = generateOpaqueToken();
  const tokenA2 = generateOpaqueToken();
  const tokenB1 = generateOpaqueToken();

  const staffUserId = `staff-${runId}`;
  const staffToken = generateOpaqueToken();

  let registeredPluginId = "";
  let manifest: PluginManifest;

  const originalEnv = { ...process.env };
  const originalDbUrl =
    process.env.DATABASE_URL || "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

  let adminClient: Client;
  let disposableDbUrl: URL;

  const sampleCourse = {
    courseId: "web-dev-101",
    title_en: "Web Development Foundations",
    title_ar: "أساسيات تطوير الويب",
    summary_en: "A comprehensive introduction to modern web engineering.",
    summary_ar: "مقدمة شاملة لهندسة الويب الحديثة.",
    lesson_title_en: "Lesson 1: Semantic HTML Architecture",
    lesson_title_ar: "الدرس 1: البنية الدلالية لـ HTML",
    lesson_body_en: "Protected Lesson Body: HTML elements give structural meaning to web documents.",
    lesson_body_ar: "نص الدرس المحمي: تمنح عناصر HTML المعنى الهيكلي لمستندات الويب.",
  };

  beforeAll(async () => {
    // 1. Resolve and build real LMS authoring and delivery artifacts
    const lmsArtifacts = await resolveAndBuildLmsAuthoringArtifacts();

    // 2. Stage into an isolated operator release directory
    tempDir = await mkdtemp(path.join(tmpdir(), "vibress-lms104-"));
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

    // 8. Start Fastify app on ephemeral port
    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as AddressInfo;
    serverPort = address.port;
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    setPluginsService(
      new PluginsService(
        new DrizzlePluginRepository(),
        new DrizzlePluginSettingRepository(),
        new BundledPluginHost(),
        new DrizzlePluginPublicationStateRepository(),
        new DrizzlePluginPublicationSettingRepository(),
      ),
    );
    await closeDbPool();
    if (adminClient) {
      try {
        if (dbName) {
          await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
        }
      } finally {
        await adminClient.end();
      }
    }
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

  it("Step 1: verifies signed release integrity and operator migration plan", async () => {
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    expect(approvedPlan.manifestId).toBe("vibress-lms-authoring");
    expect(approvedPlan.migrationId).toBe("0001_lms_authoring");
    expect(approvedPlan.models.length).toBe(3);
    const modelKeys = approvedPlan.models.map((m) => m.key);
    expect(modelKeys).toContain("courses");
    expect(modelKeys).toContain("enrollments");
    expect(modelKeys).toContain("completions");

    // Tampered artifact checksum fails closed
    const tamperedPlanPath = path.join(tempDir, "tampered-plan.json");
    await writeFile(
      tamperedPlanPath,
      JSON.stringify({ ...approvedPlan, artifactSha256: "0".repeat(64) }),
    );
    await expect(
      readVerifiedOperatorMigrationPlan(tamperedPlanPath, lockfilePath),
    ).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_RELEASE_MISMATCH" });
  });

  it("Step 2: registers plugin, applies approved models, and activates", async () => {
    const db = getDb();

    // Register plugin
    const registered = await pluginsService.registerPlugin(manifest, "operator-test");
    expect(registered.manifestId).toBe("vibress-lms-authoring");
    expect(registered.status).toBe("registered");
    registeredPluginId = registered.id;

    // Apply approved physical migration plan
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const migrator = new PluginPhysicalSchemaMigrationService(
      new DrizzlePluginStorageMigrationRepository(() => db),
    );

    const firstResult = await migrator.applyApprovedPhysical(approvedPlan);
    expect(["applied", "already_applied"]).toContain(firstResult);

    // Idempotent re-apply
    const secondResult = await migrator.applyApprovedPhysical(approvedPlan);
    expect(secondResult).toBe("already_applied");

    // Verify physical models in DB
    const models = await db
      .select()
      .from(pluginPhysicalModels)
      .where(eq(pluginPhysicalModels.pluginId, registeredPluginId));
    expect(models.length).toBe(3);
    const keys = models.map((m) => m.modelKey);
    expect(keys).toContain("courses");
    expect(keys).toContain("enrollments");
    expect(keys).toContain("completions");

    // Activate plugin
    const activated = await pluginsService.activatePlugin(registeredPluginId, "operator-test");
    expect(activated.status).toBe("active");
  });

  it("Step 3: provisions two publications, locales, enablement, staff and members", async () => {
    const db = getDb();

    // 2 Publications
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

    // Locales en & ar for both with primary keys
    await db.insert(publicationLocales).values([
      { id: randomUUID(), publicationId: pubAId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubAId, locale: "ar", status: "active", isDefault: false },
      { id: randomUUID(), publicationId: pubBId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubBId, locale: "ar", status: "active", isDefault: false },
    ]);

    // Enable plugin on both publications
    await pluginsService.setPublicationEnabled(registeredPluginId, pubAId, true, "operator-test");
    await pluginsService.setPublicationEnabled(registeredPluginId, pubBId, true, "operator-test");

    // 3 Members: 2 on Pub A, 1 on Pub B
    await db.insert(members).values([
      {
        id: memberA1Id,
        publicationId: pubAId,
        email: `learner-a1-${runId}@example.com`,
        emailNormalized: `learner-a1-${runId}@example.com`,
        status: "active",
        emailVerifiedAt: new Date(),
      },
      {
        id: memberA2Id,
        publicationId: pubAId,
        email: `learner-a2-${runId}@example.com`,
        emailNormalized: `learner-a2-${runId}@example.com`,
        status: "active",
        emailVerifiedAt: new Date(),
      },
      {
        id: memberB1Id,
        publicationId: pubBId,
        email: `learner-b1-${runId}@example.com`,
        emailNormalized: `learner-b1-${runId}@example.com`,
        status: "active",
        emailVerifiedAt: new Date(),
      },
    ]);

    const expiresAt = new Date(Date.now() + 86400000);
    await db.insert(memberSessions).values([
      {
        id: randomUUID(),
        memberId: memberA1Id,
        publicationId: pubAId,
        tokenHash: hashToken(tokenA1),
        expiresAt,
      },
      {
        id: randomUUID(),
        memberId: memberA2Id,
        publicationId: pubAId,
        tokenHash: hashToken(tokenA2),
        expiresAt,
      },
      {
        id: randomUUID(),
        memberId: memberB1Id,
        publicationId: pubBId,
        tokenHash: hashToken(tokenB1),
        expiresAt,
      },
    ]);

    const [ownerUser] = await db.select().from(users).where(eq(users.email, "owner@vibress.local")).limit(1);
    expect(ownerUser).toBeDefined();

    await db.insert(publicationMemberships).values({
      id: randomUUID(),
      publicationId: pubAId,
      userId: ownerUser.id,
      role: "owner",
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: { origin: `http://${domainA}`, host: domainA },
      payload: { email: "owner@vibress.local", password: "DevPassword123!" },
    });
    expect(loginRes.statusCode).toBe(200);
    const sessionCookie = loginRes.cookies.find((c) => c.name === "vibress_session");
    expect(sessionCookie).toBeDefined();
    process.env["STAFF_SESSION_COOKIE_" + runId] = sessionCookie.value;
  });

  it("Step 4: Staff authors course: draft -> save -> publish lifecycle and draft hiding", async () => {
    const siteA = `http://${domainA}:${serverPort}`;
    process.env.CORS_ORIGINS = `${siteA},http://${domainB}:${serverPort}`;

    const staffSessionVal = process.env["STAFF_SESSION_COOKIE_" + runId];
    const headers = {
      Host: domainA,
      Origin: "http://localhost:7777",
      Authorization: `Bearer ${staffSessionVal}`,
      Cookie: `vibress_session=${staffSessionVal}`,
      "x-publication-id": pubAId,
      "Content-Type": "application/json",
    };

    // 1. Create draft course
    const createRes = await fetch(
      `${siteA}/api/admin/v1/extensions/vibress-lms-authoring/v1/courses`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          operation: "create",
          courseId: sampleCourse.courseId,
          expectedVersion: 0,
          title_en: sampleCourse.title_en,
          title_ar: sampleCourse.title_ar,
          summary_en: sampleCourse.summary_en,
          summary_ar: sampleCourse.summary_ar,
          lesson_title_en: sampleCourse.lesson_title_en,
          lesson_title_ar: sampleCourse.lesson_title_ar,
          lesson_body_en: sampleCourse.lesson_body_en,
          lesson_body_ar: sampleCourse.lesson_body_ar,
        }),
      },
    );
    expect(createRes.status).toBe(200);
    const createdData = (await createRes.json()) as { outcome: string; version: number; status: string };
    expect(createdData.outcome).toBe("created");
    expect(createdData.version).toBe(1);
    expect(createdData.status).toBe("draft");

    // 2. Draft is completely hidden from public catalog
    const catalogDraftRes = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/page?locale=en`,
    );
    expect(catalogDraftRes.status).toBe(200);
    const catalogDraftData = (await catalogDraftRes.json()) as { data: { outcome: string; total: number } };
    expect(catalogDraftData.data.outcome).toBe("empty");
    expect(catalogDraftData.data.total).toBe(0);

    // 3. Draft course detail is not-found
    const courseDetailDraftRes = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/v1/course?courseId=${sampleCourse.courseId}&locale=en`,
    );
    expect(courseDetailDraftRes.status).toBe(200);
    const courseDetailDraftData = (await courseDetailDraftRes.json()) as { outcome: string };
    expect(courseDetailDraftData.outcome).toBe("not-found");

    // 4. Save revision
    const saveRes = await fetch(
      `${siteA}/api/admin/v1/extensions/vibress-lms-authoring/v1/courses`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          operation: "save",
          courseId: sampleCourse.courseId,
          expectedVersion: 1,
          title_en: sampleCourse.title_en,
          title_ar: sampleCourse.title_ar,
          summary_en: sampleCourse.summary_en,
          summary_ar: sampleCourse.summary_ar,
          lesson_title_en: sampleCourse.lesson_title_en,
          lesson_title_ar: sampleCourse.lesson_title_ar,
          lesson_body_en: sampleCourse.lesson_body_en,
          lesson_body_ar: sampleCourse.lesson_body_ar,
        }),
      },
    );
    expect(saveRes.status).toBe(200);
    const saveData = (await saveRes.json()) as { outcome: string; version: number };
    expect(saveData.outcome).toBe("saved");
    expect(saveData.version).toBe(2);

    // 5. Publish course
    const publishRes = await fetch(
      `${siteA}/api/admin/v1/extensions/vibress-lms-authoring/v1/courses`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          operation: "publish",
          courseId: sampleCourse.courseId,
          expectedVersion: 2,
          title_en: sampleCourse.title_en,
          title_ar: sampleCourse.title_ar,
          summary_en: sampleCourse.summary_en,
          summary_ar: sampleCourse.summary_ar,
          lesson_title_en: sampleCourse.lesson_title_en,
          lesson_title_ar: sampleCourse.lesson_title_ar,
          lesson_body_en: sampleCourse.lesson_body_en,
          lesson_body_ar: sampleCourse.lesson_body_ar,
        }),
      },
    );
    expect(publishRes.status).toBe(200);
    const publishData = (await publishRes.json()) as { outcome: string; version: number; status: string };
    expect(publishData.outcome).toBe("published");
    expect(publishData.status).toBe("published");

    // Published course is now sealed / immutable against further edit
    const reEditRes = await fetch(
      `${siteA}/api/admin/v1/extensions/vibress-lms-authoring/v1/courses`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          operation: "save",
          courseId: sampleCourse.courseId,
          expectedVersion: publishData.version,
          title_en: "Hacked",
          title_ar: "مخترق",
          summary_en: "...",
          summary_ar: "...",
          lesson_title_en: "...",
          lesson_title_ar: "...",
          lesson_body_en: "...",
          lesson_body_ar: "...",
        }),
      },
    );
    expect(reEditRes.status).toBe(200);
    expect((await reEditRes.json()).outcome).toBe("immutable");
  });

  it("Step 5: verifies public catalog and course detail with bilingual projections and strict privacy", async () => {
    const siteA = `http://${domainA}:${serverPort}`;
    const siteB = `http://${domainB}:${serverPort}`;

    // Detail-page view identity must not execute a catalog scan or return
    // plugin storage data. The Host independently checks publication and locale.
    const identityA = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/identity?locale=en`,
    );
    expect(identityA.status).toBe(200);
    expect(identityA.headers.get("cache-control")).toContain("no-store");
    const boundIdentity = (await identityA.json()) as Record<string, unknown>;
    expect(boundIdentity.publicationId).toBe(pubAId);
    expect(boundIdentity.locale).toBe("en");
    expect(boundIdentity.routeId).toBe("catalog");
    expect(boundIdentity.data).toBeUndefined();
    const identityB = await fetch(
      `${siteB}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/identity?locale=en`,
    );
    expect(identityB.status).toBe(200);
    expect(((await identityB.json()) as { publicationId: string }).publicationId).toBe(pubBId);
    const invalidLocale = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/identity?locale=fr`,
    );
    expect(invalidLocale.status).toBe(404);
    const invalidPlugin = await fetch(
      `${siteA}/api/content/v1/extensions/other-plugin/views/catalog/identity?locale=en`,
    );
    expect(invalidPlugin.status).toBe(404);

    // English public SSR catalog
    const catEnRes = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/page?locale=en`,
    );
    expect(catEnRes.status).toBe(200);
    const catEn = (await catEnRes.json()) as {
      locale: string;
      data: { outcome: string; total: number; title: string; lessonTitle: string; body?: string };
    };
    expect(catEn.locale).toBe("en");
    expect(catEn.data.outcome).toBe("published");
    expect(catEn.data.total).toBe(1);
    expect(catEn.data.title).toBe(sampleCourse.title_en);
    expect(catEn.data.lessonTitle).toBe(sampleCourse.lesson_title_en);
    // Strict privacy boundary: protected lesson body NEVER leaks to public
    expect(catEn.data.body).toBeUndefined();

    // Arabic public SSR catalog
    const catArRes = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/page?locale=ar`,
    );
    expect(catArRes.status).toBe(200);
    const catAr = (await catArRes.json()) as {
      locale: string;
      data: { outcome: string; total: number; title: string; lessonTitle: string; body?: string };
    };
    expect(catAr.locale).toBe("ar");
    expect(catAr.data.outcome).toBe("published");
    expect(catAr.data.title).toBe(sampleCourse.title_ar);
    expect(catAr.data.lessonTitle).toBe(sampleCourse.lesson_title_ar);
    expect(catAr.data.body).toBeUndefined();

    // Public course detail API
    const detailRes = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/v1/course?courseId=${sampleCourse.courseId}&locale=en`,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      outcome: string; title: string; lessonTitle: string; body?: string;
    };
    expect(detail.outcome).toBe("published");
    expect(detail.title).toBe(sampleCourse.title_en);
    expect(detail.lessonTitle).toBe(sampleCourse.lesson_title_en);
    expect(detail.body).toBeUndefined();

    // Publication B isolation: Site B catalog has no courses
    const siteBCatRes = await fetch(
      `${siteB}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/page?locale=en`,
    );
    expect(siteBCatRes.status).toBe(200);
    const siteBCat = (await siteBCatRes.json()) as { data: { outcome: string; total: number } };
    expect(siteBCat.data.outcome).toBe("empty");
    expect(siteBCat.data.total).toBe(0);
  });

  it("Step 6: verifies Member enrollment, protected lesson access, completion, and progress", async () => {
    const siteA = `http://${domainA}:${serverPort}`;
    const memberA1Headers = {
      Origin: siteA,
      Cookie: `vibress_member_session=${tokenA1}`,
      "Content-Type": "application/json",
    };
    const memberA2Headers = {
      Origin: siteA,
      Cookie: `vibress_member_session=${tokenA2}`,
      "Content-Type": "application/json",
    };

    // 1. Unenrolled Member A1 attempts to access lesson -> denied / not-found
    const unauthLessonRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=en`,
      { headers: memberA1Headers },
    );
    expect(unauthLessonRes.status).toBe(200);
    const unauthLesson = (await unauthLessonRes.json()) as { outcome: string; body: string };
    expect(unauthLesson.outcome).toBe("not-found");
    expect(unauthLesson.body).toBe("");

    // 2. Member A1 enrolls in published course
    const enrollRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/enroll`,
      {
        method: "POST",
        headers: memberA1Headers,
        body: JSON.stringify({ courseId: sampleCourse.courseId, locale: "en" }),
      },
    );
    expect(enrollRes.status).toBe(200);
    const enrollData = (await enrollRes.json()) as { outcome: string; courseId: string };
    expect(enrollData.outcome).toBe("created");
    expect(enrollData.courseId).toBe(sampleCourse.courseId);

    // Idempotent repeat enrollment
    const repeatEnrollRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/enroll`,
      {
        method: "POST",
        headers: memberA1Headers,
        body: JSON.stringify({ courseId: sampleCourse.courseId, locale: "en" }),
      },
    );
    expect(repeatEnrollRes.status).toBe(200);
    expect((await repeatEnrollRes.json()).outcome).toBe("already-enrolled");

    // 3. Enrolled Member A1 retrieves protected lesson in English
    const lessonEnRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=en`,
      { headers: memberA1Headers },
    );
    expect(lessonEnRes.status).toBe(200);
    const lessonEn = (await lessonEnRes.json()) as { outcome: string; title: string; body: string };
    expect(lessonEn.outcome).toBe("allowed");
    expect(lessonEn.title).toBe(sampleCourse.lesson_title_en);
    expect(lessonEn.body).toBe(sampleCourse.lesson_body_en);

    // Enrolled Member A1 retrieves protected lesson in Arabic
    const lessonArRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=ar`,
      { headers: memberA1Headers },
    );
    expect(lessonArRes.status).toBe(200);
    const lessonAr = (await lessonArRes.json()) as { outcome: string; title: string; body: string };
    expect(lessonAr.outcome).toBe("allowed");
    expect(lessonAr.title).toBe(sampleCourse.lesson_title_ar);
    expect(lessonAr.body).toBe(sampleCourse.lesson_body_ar);

    // 4. Unenrolled Member A2 cannot access lesson
    const unenrolledRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=en`,
      { headers: memberA2Headers },
    );
    expect(unenrolledRes.status).toBe(200);
    expect((await unenrolledRes.json()).outcome).toBe("not-found");

    // 5. Progress before completion is 0%
    const progBeforeRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/progress?courseId=${sampleCourse.courseId}`,
      { headers: memberA1Headers },
    );
    expect(progBeforeRes.status).toBe(200);
    const progBefore = (await progBeforeRes.json()) as { outcome: string; percent: number; completed: number };
    expect(progBefore.outcome).toBe("available");
    expect(progBefore.completed).toBe(0);
    expect(progBefore.percent).toBe(0);

    // 6. Complete lesson
    const completeRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/complete`,
      {
        method: "POST",
        headers: memberA1Headers,
        body: JSON.stringify({ courseId: sampleCourse.courseId, locale: "en" }),
      },
    );
    expect(completeRes.status).toBe(200);
    const completeData = (await completeRes.json()) as { outcome: string; lessonId: string };
    expect(completeData.outcome).toBe("completed");

    // Idempotent repeat completion
    const repeatCompleteRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/complete`,
      {
        method: "POST",
        headers: memberA1Headers,
        body: JSON.stringify({ courseId: sampleCourse.courseId, locale: "en" }),
      },
    );
    expect(repeatCompleteRes.status).toBe(200);
    expect((await repeatCompleteRes.json()).outcome).toBe("already-completed");

    // 7. Progress after completion is 100%
    const progAfterRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/progress?courseId=${sampleCourse.courseId}`,
      { headers: memberA1Headers },
    );
    expect(progAfterRes.status).toBe(200);
    const progAfter = (await progAfterRes.json()) as { outcome: string; percent: number; completed: number };
    expect(progAfter.outcome).toBe("available");
    expect(progAfter.completed).toBe(1);
    expect(progAfter.percent).toBe(100);

    // Unenrolled Member A2 checking progress is rejected
    const unauthProgRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/progress?courseId=${sampleCourse.courseId}`,
      { headers: memberA2Headers },
    );
    expect(unauthProgRes.status).toBe(200);
    expect((await unauthProgRes.json()).outcome).toBe("not-authorized");
  });

  it("Step 7: verifies cross-publication isolation and cross-member security", async () => {
    const siteA = `http://${domainA}:${serverPort}`;
    const siteB = `http://${domainB}:${serverPort}`;

    const memberB1OnPubAHeaders = {
      Origin: siteA,
      Cookie: `vibress_member_session=${tokenB1}`, // Member B1 belongs to Pub B, not Pub A
      "Content-Type": "application/json",
    };

    // Member B1 cannot access Member routes on Publication A (Host returns 404 PUBLICATION_NOT_FOUND)
    const crossRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=en`,
      { headers: memberB1OnPubAHeaders },
    );
    expect(crossRes.status).toBe(404);

    // Member B1 on Publication B cannot access Publication A's course
    const memberB1OnPubBHeaders = {
      Origin: siteB,
      Cookie: `vibress_member_session=${tokenB1}`,
      "Content-Type": "application/json",
    };
    const b1LessonRes = await fetch(
      `${siteB}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=en`,
      { headers: memberB1OnPubBHeaders },
    );
    expect(b1LessonRes.status).toBe(200);
    expect((await b1LessonRes.json()).outcome).toBe("not-found");
  });

  it("Step 8: verifies CSRF / Origin enforcement on state-changing member requests", async () => {
    const siteA = `http://${domainA}:${serverPort}`;
    const forgedHeaders = {
      Origin: "https://evil-attacker.com",
      Cookie: `vibress_member_session=${tokenA1}`,
      "Content-Type": "application/json",
    };

    const forgedRes = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/enroll`,
      {
        method: "POST",
        headers: forgedHeaders,
        body: JSON.stringify({ courseId: sampleCourse.courseId, locale: "en" }),
      },
    );
    expect(forgedRes.status).toBe(403);
  });

  it("Step 9: verifies plugin lifecycle: deactivation fails closed, reactivation preserves data", async () => {
    const siteA = `http://${domainA}:${serverPort}`;
    const memberA1Headers = {
      Origin: siteA,
      Cookie: `vibress_member_session=${tokenA1}`,
      "Content-Type": "application/json",
    };

    // 1. Deactivate plugin
    await pluginsService.deactivatePlugin(registeredPluginId, "operator-test");

    // 2. Public and member routes fail closed (404)
    const catDeactivated = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/page?locale=en`,
    );
    expect(catDeactivated.status).toBe(404);

    const lessonDeactivated = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${sampleCourse.courseId}&locale=en`,
      { headers: memberA1Headers },
    );
    expect(lessonDeactivated.status).toBe(404);

    // 3. Reactivate plugin
    await pluginsService.activatePlugin(registeredPluginId, "operator-test");

    // 4. Public catalog works again
    const catReactivated = await fetch(
      `${siteA}/api/content/v1/extensions/vibress-lms-authoring/views/catalog/page?locale=en`,
    );
    expect(catReactivated.status).toBe(200);
    expect((await catReactivated.json()).data.outcome).toBe("published");

    // 5. Member A1 progress and completion remain 100% intact!
    const progReactivated = await fetch(
      `${siteA}/api/members/v1/extensions/vibress-lms-authoring/v1/progress?courseId=${sampleCourse.courseId}`,
      { headers: memberA1Headers },
    );
    expect(progReactivated.status).toBe(200);
    const progData = (await progReactivated.json()) as { outcome: string; percent: number; completed: number };
    expect(progData.outcome).toBe("available");
    expect(progData.percent).toBe(100);
    expect(progData.completed).toBe(1);
  });
});
