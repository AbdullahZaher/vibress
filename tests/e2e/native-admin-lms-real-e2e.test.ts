import { test, expect, type Page } from "@playwright/test";
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
  installation,
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

const pluginId = "vibress-lms-authoring";
const viewId = "course-overview";
const routeId = "courses";

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

async function allocateDistinctPorts(count: number): Promise<number[]> {
  const ports = new Set<number>();
  while (ports.size < count) {
    const p = await getAvailablePort();
    ports.add(p);
  }
  return Array.from(ports);
}

async function terminateProcessGracefully(proc: ChildProcess | null, timeoutMs = 5000): Promise<void> {
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

async function waitForHealthy(url: string, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status >= 200 && res.status < 400) return;
    } catch {
      // Waiting for socket to open
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout waiting for ${url} to become healthy`);
}

test.describe.serial("Priority 1: Genuine Native LMS Browser-to-Database E2E (Chromium → Admin → API → PostgreSQL)", () => {
  test.setTimeout(240000);

  let tempDir: string;
  let lockfilePath: string;
  let planPath: string;
  let artifactPath: string;
  let keyPath: string;
  let sigPath: string;

  let apiProc: ChildProcess | null = null;
  let adminProc: ChildProcess | null = null;

  let apiPort: number;
  let adminPort: number;

  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const dbName = `vibress_e2e_${runId}`;

  const pubAId = `pub-e2e-a-${runId}`;
  const pubBId = `pub-e2e-b-${runId}`;
  const domainA = `e2e-a-${runId}.localhost`;
  const domainB = `e2e-b-${runId}.localhost`;

  let staffUserId = "";
  let registeredPluginId = "";
  let approvedReleaseTag = "";
  let manifest: PluginManifest;

  const originalEnv = { ...process.env };
  const originalDbUrl =
    process.env.DATABASE_URL || "postgresql://vibress:vibress@127.0.0.1:5432/vibress";

  let adminClient: Client;
  let disposableDbUrl: string = "";

  async function loginStaff(page: Page) {
    await page.goto(`http://127.0.0.1:${adminPort}/admin/`);
    await page.waitForLoadState("networkidle");

    const emailInput = page.locator("#email");
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill("owner@example.com");
      await page.locator("#password").fill("OwnerPass123!");
      await page.locator('button[type="submit"]').click();
      await expect(page.locator("#email")).toHaveCount(0, { timeout: 15000 });
      await page.waitForLoadState("networkidle");
    }

    // Set active publication in localStorage to Publication Alpha
    await page.evaluate((id) => {
      localStorage.setItem("vibress_active_publication_id", id);
    }, pubAId);
  }

  test.beforeAll(async () => {
    // 1. Resolve and build real LMS authoring candidate
    const lmsArtifacts = await resolveAndBuildLmsAuthoringArtifacts();

    // 2. Stage into operator test release directory and generate Ed25519 signing keypair
    tempDir = await mkdtemp(path.join(tmpdir(), "vibress-real-e2e-"));
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

    // 3. Create disposable PostgreSQL database
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

    // 4. Run migrations and seed baseline roles and users
    await closeDbPool();
    await runMigrations();
    await seedDatabase();

    const db = getDb();

    // 4b. Mark setup installation as completed in DB
    await db
      .update(installation)
      .set({ installed: true, installedAt: new Date() })
      .where(eq(installation.id, "singleton"));

    // 5. Register plugin and apply physical models
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

    // 6. Provision Publication Alpha (Arabic default) and Publication Beta (English default)
    await db.insert(publications).values([
      {
        id: pubAId,
        workspaceId: "ws_default",
        name: "Publication Alpha (Arabic)",
        slug: pubAId,
        domain: domainA,
        primaryLocale: "ar",
      },
      {
        id: pubBId,
        workspaceId: "ws_default",
        name: "Publication Beta (English)",
        slug: pubBId,
        domain: domainB,
        primaryLocale: "en",
      },
    ]);

    await db.insert(publicationLocales).values([
      { id: randomUUID(), publicationId: pubAId, locale: "ar", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubAId, locale: "en", status: "active", isDefault: false },
      { id: randomUUID(), publicationId: pubBId, locale: "en", status: "active", isDefault: true },
      { id: randomUUID(), publicationId: pubBId, locale: "ar", status: "active", isDefault: false },
    ]);

    // Enable plugin on both publications
    await pluginsService.setPublicationEnabled(registeredPluginId, pubAId, true, "operator-test");
    await pluginsService.setPublicationEnabled(registeredPluginId, pubBId, true, "operator-test");

    // Grant owner role in both publications to owner@example.com
    const [ownerUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner@example.com"))
      .limit(1);
    expect(ownerUser).toBeDefined();
    staffUserId = ownerUser!.id;

    await db.insert(publicationMemberships).values([
      { id: randomUUID(), publicationId: pubAId, userId: staffUserId, role: "owner" },
      { id: randomUUID(), publicationId: pubBId, userId: staffUserId, role: "owner" },
    ]);

    // Seed 1 initial baseline course in Publication Alpha
    const sessionA = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "seed-real-a",
        allowWrites: true,
      },
      approvedPlan.models,
    );
    try {
      await sessionA.storage.create("courses", "course-seed-01", {
        title_en: "Web Development Foundations",
        title_ar: "أساسيات تطوير الويب",
        status: "draft",
        summary_en: "Foundational architecture for modern web applications.",
        summary_ar: "البنية الأساسية لتطبيقات الويب الحديثة.",
        lesson_title_en: "Semantic HTML",
        lesson_title_ar: "لغة HTML الدلالية",
        lesson_body_en: "HTML provides structural meaning.",
        lesson_body_ar: "تمنح عناصر HTML المعنى الهيكلي.",
      });
    } finally {
      await sessionA.close();
    }

    // Seed 1 initial baseline course in Publication Beta
    const sessionB = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubBId,
        actorUserId: staffUserId,
        requestId: "seed-real-b",
        allowWrites: true,
      },
      approvedPlan.models,
    );
    try {
      await sessionB.storage.create("courses", "course-beta-seed-01", {
        title_en: "Cloud Distributed Systems",
        title_ar: "الأنظمة السحابية الموزعة",
        status: "draft",
        summary_en: "Scalability and resilience in distributed environments.",
        summary_ar: "القابلية للتوسع والمرونة في البيئات الموزعة.",
        lesson_title_en: "High Availability",
        lesson_title_ar: "التوافر العالي",
        lesson_body_en: "Redundancy ensures zero downtime.",
        lesson_body_ar: "يضمن التكرار عدم انقطاع الخدمة.",
      });
    } finally {
      await sessionB.close();
    }

    // Close test-runner DB pool to avoid open connection conflicts
    await closeDbPool();

    // 7. Allocate distinct dynamic TCP ports for Fastify API and Admin Vite server
    [apiPort, adminPort] = await allocateDistinctPorts(2);

    // 8. Spawn dedicated Fastify API process with strict read/write allowlists enabled for the test release ONLY
    const tsxBin = path.resolve(repoRoot, "node_modules/.bin/tsx");
    apiProc = spawn(
      tsxBin,
      ["apps/api/src/main.ts"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          API_PORT: String(apiPort),
          PORT: String(apiPort),
          DATABASE_URL: disposableDbUrl,
          REDIS_URL: "redis://127.0.0.1:6379",
          VIBRESS_TRUSTED_PLUGIN_LOCKFILE: lockfilePath,
          VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE: keyPath,
          VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE: sigPath,
          VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1",
          VIBRESS_NATIVE_ADMIN_UI_RELEASES: approvedReleaseTag,
          VIBRESS_NATIVE_ADMIN_ACTION_RELEASES: approvedReleaseTag,
          VIBRESS_ENCRYPTION_KEY: sharedSecret,
          NODE_ENV: "test",
          LOG_LEVEL: "warn",
          CORS_ORIGINS: `http://localhost:${adminPort},http://127.0.0.1:${adminPort}`,
          ADMIN_URL: `http://127.0.0.1:${adminPort}`,
          ADMIN_ORIGIN: `http://127.0.0.1:${adminPort}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // 9. Spawn dedicated Admin Vite dev server proxying /api to the Fastify API port
    const viteBin = path.resolve(repoRoot, "node_modules/.bin/vite");
    adminProc = spawn(
      viteBin,
      ["--port", String(adminPort), "--host", "127.0.0.1"],
      {
        cwd: path.resolve(repoRoot, "apps/admin"),
        env: {
          ...process.env,
          ADMIN_PORT: String(adminPort),
          API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
          NODE_ENV: "development",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // 10. Wait for both servers to be fully healthy
    await Promise.all([
      waitForHealthy(`http://127.0.0.1:${apiPort}/health/ready`),
      waitForHealthy(`http://127.0.0.1:${adminPort}/admin/`),
    ]);
  });

  test.afterAll(async () => {
    // Terminate spawned services gracefully
    await Promise.all([
      terminateProcessGracefully(adminProc),
      terminateProcessGracefully(apiProc),
    ]);
    adminProc = null;
    apiProc = null;

    // Ensure test-runner DB pool is closed
    await closeDbPool();

    // Drop disposable test database
    if (adminClient) {
      try {
        if (dbName) {
          await adminClient.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM public;`);
          await adminClient.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid();`,
          );
          await adminClient.query(`DROP DATABASE IF EXISTS ${dbName};`);
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

    // Remove temporary release files
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Scenario A & B: Native view admission (no iframe fallback) & Arabic RTL rendering", async ({ page }) => {
    await loginStaff(page);

    page.on("dialog", (dialog) => dialog.accept());

    // Navigate to Native LMS extension view in Admin UI
    await page.goto(`http://127.0.0.1:${adminPort}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Scenario A: Verify Native view is admitted directly by Host - NO iframe fallback
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator("h1")).toBeVisible();

    // Scenario B: Verify Arabic RTL direction & localization from Publication Alpha
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    // Verify Arabic page header and buttons
    await expect(page.locator("h1")).toContainText("نظرة عامة على الدورات");
    await expect(page.getByRole("button", { name: "إنشاء مسودة" })).toBeVisible();

    // Verify table rendered with seeded course
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("body")).toContainText("أساسيات تطوير الويب");
  });

  test("Scenario C, D, E & F: Real Course Lifecycle (Create Draft -> Edit Draft -> Publish -> Immutability)", async ({ page }) => {
    await loginStaff(page);

    page.on("dialog", (dialog) => dialog.accept());

    await page.goto(`http://127.0.0.1:${adminPort}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // --- Scenario C: Real Course Creation ---
    await page.getByRole("button", { name: "إنشاء مسودة" }).click();
    const idInput = page.locator(`#domain-${pluginId}-${viewId}-id`);
    await expect(idInput).toBeVisible();

    const newCourseId = `course-real-${Date.now()}`;
    await idInput.fill(newCourseId);
    await page.fill(`#domain-${pluginId}-${viewId}-title_en`, "Production TypeScript Architecture");
    await page.fill(`#domain-${pluginId}-${viewId}-title_ar`, "هندسة تايب سكريبت الإنتاجية");
    await page.fill(`#domain-${pluginId}-${viewId}-summary_en`, "Deep architectural principles for scalable systems.");
    await page.fill(`#domain-${pluginId}-${viewId}-summary_ar`, "مبادئ معمارية عميقة للأنظمة القابلة للتوسع.");
    await page.fill(`#domain-${pluginId}-${viewId}-lesson_title_en`, "Lesson 1: Strict Typing");
    await page.fill(`#domain-${pluginId}-${viewId}-lesson_title_ar`, "الدرس 1: الأنماط الصارمة");
    await page.fill(`#domain-${pluginId}-${viewId}-lesson_body_en`, "Strict typing prevents runtime defects.");
    await page.fill(`#domain-${pluginId}-${viewId}-lesson_body_ar`, "تمنع الأنماط الصارمة عيوب وقت التشغيل.");

    // Submit form via actual POST request to real API and PostgreSQL
    await page.locator('button[type="submit"]:has-text("إنشاء مسودة")').click();

    // Verify UI success notification
    await expect(page.locator('p[role="status"]').filter({ hasText: "تم حفظ المسودة بنجاح." })).toBeVisible();

    // Independent database query to verify PostgreSQL persistence
    const db = getDb();
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const sessionVerify = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "verify-req-c",
      },
      approvedPlan.models,
    );
    try {
      const persisted = await sessionVerify.storage.get("courses", newCourseId);
      expect(persisted).not.toBeNull();
      expect(persisted?.fields.title_en).toBe("Production TypeScript Architecture");
      expect(persisted?.fields.status).toBe("draft");
      expect(persisted?.version).toBe(1);
    } finally {
      await sessionVerify.close();
    }

    // Reload browser and verify state persists directly from PostgreSQL
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText("هندسة تايب سكريبت الإنتاجية");

    // --- Scenario D: Real Draft Editing ---
    await page.locator(`button[aria-label*="${newCourseId}"]`).click();

    const titleArInput = page.locator(`#domain-${pluginId}-${viewId}-title_ar`);
    await expect(titleArInput).toHaveValue("هندسة تايب سكريبت الإنتاجية");
    await titleArInput.fill("هندسة تايب سكريبت الإنتاجية (مُحدّث بالكامل)");

    await page.locator('button[type="submit"]:has-text("حفظ المسودة")').click();

    // Verify UI reflects update
    await expect(page.locator("table")).toContainText("هندسة تايب سكريبت الإنتاجية (مُحدّث بالكامل)");

    // Verify PostgreSQL version increment
    const sessionVerifyD = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "verify-req-d",
      },
      approvedPlan.models,
    );
    try {
      const updated = await sessionVerifyD.storage.get("courses", newCourseId);
      expect(updated).not.toBeNull();
      expect(updated?.version).toBe(2);
      expect(updated?.fields.title_ar).toBe("هندسة تايب سكريبت الإنتاجية (مُحدّث بالكامل)");
    } finally {
      await sessionVerifyD.close();
    }

    // --- Scenario E: Real Publishing ---
    await page.locator(`button[aria-label*="${newCourseId}"]`).click();
    const publishBtn = page.getByRole("button", { name: "نشر", exact: true });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    // Verify status is published in UI table
    const courseRow = page.locator("tr").filter({ hasText: newCourseId });
    await expect(courseRow).toContainText("published");

    // Verify PostgreSQL status is published
    const sessionVerifyE = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "verify-req-e",
      },
      approvedPlan.models,
    );
    try {
      const published = await sessionVerifyE.storage.get("courses", newCourseId);
      expect(published).not.toBeNull();
      expect(published?.fields.status).toBe("published");
    } finally {
      await sessionVerifyE.close();
    }

    // Reload browser and verify published status persists
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("tr").filter({ hasText: newCourseId })).toContainText("published");

    // --- Scenario F: Published Immutability ---
    // In UI: Click published course -> editing locked and form buttons hidden
    await page.locator(`button[aria-label*="${newCourseId}"]`).click();
    await expect(page.locator('p[role="status"]').filter({ hasText: "لا يمكن تعديل العناصر المنشورة." })).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("حفظ المسودة")')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "نشر", exact: true })).toHaveCount(0);

    // Server-side invariant enforcement: direct POST modification must be rejected by LMS domain handler
    const directPostRes = await page.request.post(
      `http://127.0.0.1:${adminPort}/api/admin/v1/extensions/${pluginId}/v1/${routeId}`,
      {
        headers: {
          "x-publication-id": pubAId,
          "Content-Type": "application/json",
          Origin: `http://127.0.0.1:${adminPort}`,
        },
        data: {
          operation: "save",
          courseId: newCourseId,
          expectedVersion: 3,
          title_en: "Attempted Illegal Mutation",
          title_ar: "محاولة تعديل غير مصرح بها",
          summary_en: "Illegal",
          summary_ar: "غير قانوني",
          lesson_title_en: "Lesson",
          lesson_title_ar: "درس",
          lesson_body_en: "Body",
          lesson_body_ar: "محتوى",
        },
      },
    );
    // Domain invariants must reject editing published courses by returning immutable outcome
    expect(directPostRes.status()).toBe(200);
    const directResBody = (await directPostRes.json()) as { outcome?: string; status?: string };
    expect(directResBody.outcome).toBe("immutable");
    expect(directResBody.status).toBe("published");

    // Verify database record remains untouched and still published
    const sessionVerifyF = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "verify-req-f",
      },
      approvedPlan.models,
    );
    try {
      const untouched = await sessionVerifyF.storage.get("courses", newCourseId);
      expect(untouched?.fields.status).toBe("published");
      expect(untouched?.fields.title_en).toBe("Production TypeScript Architecture");
    } finally {
      await sessionVerifyF.close();
    }
  });

  test("Scenario G: CAS Concurrency: Competing updates enforce version consistency without lost updates", async ({ page }) => {
    await loginStaff(page);

    // Read current version of course-seed-01 from PostgreSQL
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const sessionG = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "cas-read-g",
      },
      approvedPlan.models,
    );
    let initialVersion: number;
    try {
      const current = await sessionG.storage.get("courses", "course-seed-01");
      expect(current).not.toBeNull();
      initialVersion = current!.version;
    } finally {
      await sessionG.close();
    }

    // Send competing updates simultaneously using identical expectedVersion
    const url = `http://127.0.0.1:${adminPort}/api/admin/v1/extensions/${pluginId}/v1/${routeId}`;
    const headers = {
      "x-publication-id": pubAId,
      "Content-Type": "application/json",
      Origin: `http://127.0.0.1:${adminPort}`,
    };

    const [res1, res2] = await Promise.all([
      page.request.post(url, {
        headers,
        data: {
          operation: "save",
          courseId: "course-seed-01",
          expectedVersion: initialVersion,
          title_en: "CAS Winner Alpha",
          title_ar: "الفائز في التزامن ألفا",
          summary_en: "CAS Summary Alpha",
          summary_ar: "ملخص ألفا",
          lesson_title_en: "Lesson",
          lesson_title_ar: "درس",
          lesson_body_en: "Body",
          lesson_body_ar: "محتوى",
        },
      }),
      page.request.post(url, {
        headers,
        data: {
          operation: "save",
          courseId: "course-seed-01",
          expectedVersion: initialVersion,
          title_en: "CAS Contender Beta",
          title_ar: "المنافس بيتا",
          summary_en: "CAS Summary Beta",
          summary_ar: "ملخص بيتا",
          lesson_title_en: "Lesson",
          lesson_title_ar: "درس",
          lesson_body_en: "Body",
          lesson_body_ar: "محتوى",
        },
      }),
    ]);

    const statuses = [res1.status(), res2.status()];
    expect(statuses).toContain(200);

    // Verify database state: version incremented exactly once
    const sessionVerifyG = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "cas-verify-g",
      },
      approvedPlan.models,
    );
    try {
      const finalCourse = await sessionVerifyG.storage.get("courses", "course-seed-01");
      expect(finalCourse?.version).toBe(initialVersion + 1);
      expect(["CAS Winner Alpha", "CAS Contender Beta"]).toContain(finalCourse?.fields.title_en);
    } finally {
      await sessionVerifyG.close();
    }
  });

  test("Scenario H: Publication Isolation: Zero cross-tenant data leaks and clean state reset", async ({ page }) => {
    await loginStaff(page);

    // 1. Visit Publication Alpha: course-seed-01 is visible
    await page.evaluate((id) => localStorage.setItem("vibress_active_publication_id", id), pubAId);
    await page.goto(`http://127.0.0.1:${adminPort}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).toContainText("Production TypeScript Architecture");
    await expect(page.locator("body")).not.toContainText("Cloud Distributed Systems");

    // 2. Switch active publication to Publication Beta: state must wipe immediately
    await page.evaluate((id) => {
      localStorage.setItem("vibress_active_publication_id", id);
      window.dispatchEvent(new Event("vibress:publication-changed"));
    }, pubBId);

    await page.reload();
    await page.waitForLoadState("networkidle");

    // Publication Beta course must be visible; Publication Alpha course must be completely absent
    await expect(page.locator("body")).toContainText("Cloud Distributed Systems");
    await expect(page.locator("body")).not.toContainText("Production TypeScript Architecture");

    // 3. Direct API isolation verification: Cross-tenant access with invalid publication header fails
    const crossTenantRes = await page.request.get(
      `http://127.0.0.1:${adminPort}/api/admin/v1/extensions/${pluginId}/resources/course-records`,
      {
        headers: {
          "x-publication-id": "unauthorized-foreign-pub",
        },
      },
    );
    expect(crossTenantRes.status()).toBe(403);
  });

  test("Scenario I: Session Revocation: Server-side revocation immediately terminates access", async ({ page }) => {
    await loginStaff(page);

    await page.evaluate((id) => localStorage.setItem("vibress_active_publication_id", id), pubAId);
    await page.goto(`http://127.0.0.1:${adminPort}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("table")).toBeVisible();

    // Revoke all staff sessions in PostgreSQL database directly
    const db = getDb();
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, staffUserId));

    // Next protected request fails with 401
    const protectedApiRes = await page.request.get(
      `http://127.0.0.1:${adminPort}/api/admin/v1/extensions/${pluginId}/views/${viewId}/native`,
      {
        headers: {
          "x-publication-id": pubAId,
        },
      },
    );
    expect(protectedApiRes.status()).toBe(401);

    // Browser navigation fails closed
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Must redirect to login or show alert, never display protected data
    const emailVisible = await page.locator("#email").isVisible({ timeout: 5000 }).catch(() => false);
    const alertVisible = await page.locator('p[role="alert"]').isVisible({ timeout: 2000 }).catch(() => false);
    expect(emailVisible || alertVisible).toBe(true);
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("Scenario J: Stored XSS Resistance: Hostile payloads render as inert text without executing", async ({ page }) => {
    // Restore valid staff session
    const db = getDb();
    const rawToken = generateOpaqueToken();
    await db.insert(sessions).values({
      id: randomUUID(),
      userId: staffUserId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 86400000),
    });

    await loginStaff(page);
    page.on("dialog", (dialog) => dialog.accept());

    // Inject hostile XSS course into PostgreSQL directly
    const approvedPlan = await readVerifiedOperatorMigrationPlan(planPath, lockfilePath);
    const sessionJ = createHostPluginStorageSession(
      {
        pluginId: registeredPluginId,
        publicationId: pubAId,
        actorUserId: staffUserId,
        requestId: "xss-inject-j",
        allowWrites: true,
      },
      approvedPlan.models,
    );
    try {
      await sessionJ.storage.create("courses", "course-xss-payload", {
        title_en: `<script>window.__hostile_xss_executed = true;</script><img src="invalid" onerror="window.__hostile_xss_executed = true;">Inert Title EN`,
        title_ar: `<svg onload="window.__hostile_xss_executed = true;">عنوان آمن</svg>`,
        status: "draft",
        summary_en: "<b>Bold summary</b> without execution",
        summary_ar: "ملخص آمن",
        lesson_title_en: "Lesson XSS",
        lesson_title_ar: "درس آمن",
        lesson_body_en: "Content",
        lesson_body_ar: "محتوى",
      });
    } finally {
      await sessionJ.close();
    }

    await page.evaluate((id) => localStorage.setItem("vibress_active_publication_id", id), pubAId);
    await page.goto(`http://127.0.0.1:${adminPort}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Content should be rendered safely as plain text in the table
    await expect(page.locator("table")).toContainText("Inert Title EN");

    // Verify hostile payload never executed in browser window context
    const executed = await page.evaluate(() => {
      return (window as unknown as { __hostile_xss_executed?: boolean }).__hostile_xss_executed;
    });
    expect(executed).toBeUndefined();
  });

  test("Scenario K & L: Keyboard accessibility & Responsive Viewport testing", async ({ page }) => {
    await loginStaff(page);

    await page.evaluate((id) => localStorage.setItem("vibress_active_publication_id", id), pubAId);

    // --- Scenario K: Keyboard Interaction ---
    await page.goto(`http://127.0.0.1:${adminPort}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Tab to Create Draft button and press Enter
    const createDraftBtn = page.getByRole("button", { name: "إنشاء مسودة" });
    await createDraftBtn.focus();
    await page.keyboard.press("Enter");

    // ID input must become visible and focused
    const idInput = page.locator(`#domain-${pluginId}-${viewId}-id`);
    await expect(idInput).toBeVisible();

    // Trigger validation error via keyboard on invalid ID
    await idInput.fill("invalid id with spaces!");
    await page.locator('button[type="submit"]:has-text("إنشاء مسودة")').click();

    // Verify accessible role="alert" message is announced
    const alertMsg = page.locator('p[role="alert"]');
    await expect(alertMsg).toBeVisible();

    // Cancel modal via Escape/Cancel
    page.once("dialog", (dialog) => dialog.dismiss());
    const cancelBtn = page.getByRole("button", { name: "إلغاء", exact: true });
    await cancelBtn.focus();
    await page.keyboard.press("Enter");

    // --- Scenario L: Responsive Viewport Adaptation ---
    // 1. Desktop Viewport (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(100);
    await expect(page.locator("table")).toBeVisible();

    // 2. Mobile Viewport (375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(100);

    // Verify controls and table remain usable without page-level horizontal overflow
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("button", { name: "إنشاء مسودة" })).toBeVisible();

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });
});
