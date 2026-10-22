/**
 * EXT-505: signed, operator-pinned LMS-shaped plugin fixture through the
 * actual PostgreSQL migration ledger and Member-owned Host repository.
 * Disposable test schemas and ephemeral signing keys only. The fixture is
 * deliberately NOT the independently distributed vibress-lms artifact;
 * a deployed two-publication HTTP acceptance remains a separate release gate.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDbPool, schema } from "@vibress/database";
import type { Plugin } from "../src/domain/plugin";
import {
  pluginPhysicalMigrationDigest, pluginPhysicalModelDigest,
  PluginPhysicalSchemaMigrationService,
} from "../src/application/plugin-storage-migrations";
import { DrizzlePluginStorageMigrationRepository } from "../src/infrastructure/drizzle-plugin-storage-migrations";
import { DrizzlePluginMemberStorageRepository } from "../src/infrastructure/drizzle-plugin-member-storage";
import { createHostPluginMemberStorageSession } from "../src/application/plugin-member-storage-session";
import { TrustedExternalPluginHost } from "../src/application/trusted-external-plugin-host";
import { readVerifiedOperatorMigrationPlan } from "../../../../scripts/plugins/read-verified-migration-plan";

const manifestId = "vibress-lms-pilot-test";
const courseId = "pilot-foundations";
const capabilities = [
  "extension.routes.member", "extension.member_storage.read", "extension.member_storage.write",
];
const declarations = [
  { key: "enrollments", columns: [
    { name: "course_key", type: "text", required: true },
    { name: "state", type: "text", required: true },
  ] },
  { key: "completions", columns: [
    { name: "course_key", type: "text", required: true },
    { name: "lesson_key", type: "text", required: true },
    { name: "completed_at", type: "timestamptz", required: true },
  ] },
] as const;
const digest = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const models = declarations.map((model) => ({
  ...model, schemaSha256: pluginPhysicalModelDigest(model.columns),
}));
// This ESM module is intentionally small: the real Host evaluates exactly
// these signed module bytes via data URL without an imported private package.
const moduleSource = `export default {
  async activate() {},
  routes: [{
    id: "enroll", audience: "member", method: "POST",
    body: { fields: { courseId: "string" }, required: ["courseId"] },
    response: { fields: { outcome: "string" }, required: ["outcome"] },
    async handle({ body }, scope) {
      if (body.courseId !== "pilot-foundations" || !scope.memberStorage) {
        return { outcome: "denied" };
      }
      const existing = await scope.memberStorage.get("enrollments", "pilot-foundations");
      if (existing) return { outcome: "already-enrolled" };
      await scope.memberStorage.create("enrollments", "pilot-foundations", {
        course_key: "pilot-foundations", state: "active",
      });
      return { outcome: "created" };
    },
  }],
};`;
const version = "0.1.0-test";
const manifest = {
  id: manifestId, name: "Signed LMS Fixture", version,
  vibressApiVersion: "1.0.0", description: "Disposable signed acceptance fixture",
  entrypoint: "pilot.mjs", capabilities, hooks: [], settingsSchema: {},
};
const restoreEnv = new Map<string, string | undefined>();
function setTestEnv(key: string, value: string): void {
  if (!restoreEnv.has(key)) restoreEnv.set(key, process.env[key]);
  process.env[key] = value;
}
afterEach(() => {
  for (const [key, original] of restoreEnv) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  restoreEnv.clear();
});

async function signedRelease() {
  const directory = await mkdtemp(path.join(tmpdir(), "vibress-lms-signed-test-"));
  const lockfilePath = path.join(directory, "trusted-plugins.json");
  const planPath = path.join(directory, "migration-plan.json");
  const artifactPath = path.join(directory, "pilot.mjs");
  const keyPath = path.join(directory, "operator-public.pem");
  const signaturePath = path.join(directory, "operator.sig");
  const bytes = Buffer.from(moduleSource, "utf8");
  const artifactSha256 = digest(bytes);
  const plan = {
    manifestId, migrationId: "0001_lms_pilot", packageVersion: version,
    artifactSha256, migrationSha256: pluginPhysicalMigrationDigest(models), models,
  };
  const lockfile = {
    schemaVersion: 1,
    plugins: [{ manifest, sha256: artifactSha256, storageModels: models }],
  };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const lockBytes = Buffer.from(JSON.stringify(lockfile), "utf8");
  await Promise.all([
    writeFile(artifactPath, bytes),
    writeFile(lockfilePath, lockBytes),
    writeFile(planPath, JSON.stringify(plan)),
    writeFile(keyPath, publicKey.export({ format: "pem", type: "spki" })),
    writeFile(signaturePath, sign(null, lockBytes, privateKey).toString("base64") + "\n"),
  ]);
  setTestEnv("VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE", "1");
  setTestEnv("VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE", keyPath);
  setTestEnv("VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE", signaturePath);
  return { directory, lockfilePath, planPath, artifactPath, plan };
}

async function migrationSql(name: string): Promise<string> {
  // The same released migration files used by the EXT-205 infrastructure tests.
  const file = path.resolve(__dirname, "../../../database/migrations", name);
  return readFile(file, "utf8");
}
const coreMigrations = [
  "0040_plugin_publication_states.sql", "0042_plugin_migration_storage_foundation.sql",
  "0043_plugin_storage_physical_models.sql", "0045_plugin_member_records.sql",
];

describe("EXT-505 signed LMS-shaped release through real Host and PostgreSQL", () => {
  it("rejects tampered release and migration plans before accessing PostgreSQL", async () => {
    const r = await signedRelease();
    try {
      const approved = await readVerifiedOperatorMigrationPlan(r.planPath, r.lockfilePath);
      expect(approved).toMatchObject(r.plan);
      await writeFile(r.planPath, JSON.stringify({ ...r.plan, artifactSha256: "a".repeat(64) }));
      await expect(readVerifiedOperatorMigrationPlan(r.planPath, r.lockfilePath))
        .rejects.toMatchObject({ code: "PLUGIN_MIGRATION_RELEASE_MISMATCH" });
      await writeFile(r.planPath, JSON.stringify(r.plan));
      await writeFile(r.artifactPath, "export default { async activate() {}, compromised: true };");
      await expect(readVerifiedOperatorMigrationPlan(r.planPath, r.lockfilePath))
        .rejects.toThrow();
    } finally {
      await rm(r.directory, { recursive: true, force: true });
    }
  });

  it("admits signed models transactionally, loads pinned ESM and isolates two sites", async () => {
    const r = await signedRelease();
    const client = await getDbPool().connect();
    const ns = "signed_lms_" + randomUUID().replaceAll("-", "");
    let schemaCreated = false;
    try {
      const approved = await readVerifiedOperatorMigrationPlan(r.planPath, r.lockfilePath);
      const host = new TrustedExternalPluginHost(r.lockfilePath);
      expect((await host.listTrustedManifests()).map((m) => m.id)).toEqual([manifestId]);

      await client.query(`CREATE SCHEMA "${ns}"`);
      schemaCreated = true;
      await client.query(`SET search_path TO "${ns}"`);
      await client.query(`
        CREATE TABLE publications (id text PRIMARY KEY);
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          status text NOT NULL, version text NOT NULL,
          capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        CREATE TABLE members (
          id text PRIMARY KEY,
          publication_id text NOT NULL REFERENCES publications(id),
          status text NOT NULL
        );
        CREATE TABLE audit_events (
          id text PRIMARY KEY, publication_id text, actor_user_id text,
          request_id text NOT NULL, action text NOT NULL, target_type text NOT NULL,
          target_id text, ip_address text, user_agent text, metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO publications VALUES ('pub-a'), ('pub-b');
        INSERT INTO plugins VALUES
          ('plugin-a', '${manifestId}', 'registered', '${version}',
           '["extension.routes.member","extension.member_storage.read","extension.member_storage.write"]'::jsonb);
        INSERT INTO members VALUES
          ('member-a', 'pub-a', 'active'),
          ('member-a2', 'pub-a', 'active'),
          ('member-b', 'pub-b', 'active');
      `);
      for (const name of coreMigrations) await client.query(await migrationSql(name));
      const db = drizzle(client, { schema });
      const migrator = new PluginPhysicalSchemaMigrationService(
        new DrizzlePluginStorageMigrationRepository(() => db),
      );
      expect(await migrator.applyApprovedPhysical(approved)).toBe("applied");
      expect(await migrator.applyApprovedPhysical(approved)).toBe("already_applied");
      const count = await client.query("SELECT count(*)::int AS n FROM plugin_storage_physical_models");
      expect(count.rows[0]?.n).toBe(2);
      await client.query(`
        UPDATE plugins SET status='active';
        INSERT INTO plugin_publication_states (plugin_id, publication_id, enabled)
        VALUES ('plugin-a','pub-a',true), ('plugin-a','pub-b',true);
      `);
      const now = new Date();
      const plugin: Plugin = {
        id: "plugin-a", manifestId, name: manifest.name, version,
        vibressApiVersion: manifest.vibressApiVersion, description: manifest.description,
        entrypoint: manifest.entrypoint, capabilities: [...capabilities], hooks: [],
        settingsSchema: {}, status: "active", createdAt: now, updatedAt: now,
      };
      const module = await host.loadModule(plugin);
      expect(module).not.toBeNull();
      const route = module?.routes?.find((entry) => entry.audience === "member" &&
        entry.id === "enroll" && entry.method === "POST");
      expect(route).toBeDefined();
      if (!route) throw new Error("Expected approved member route");
      const repo = new DrizzlePluginMemberStorageRepository(() => db);
      const principal = (publicationId: string, memberId: string, allowWrites: boolean) => ({
        pluginId: "plugin-a", publicationId, memberId,
        requestId: "req-signed", allowWrites,
      });
      const a = createHostPluginMemberStorageSession(principal("pub-a", "member-a", true), models, repo);
      try {
        const scope = {
          publicationId: "pub-a", requestId: "req-signed",
          principal: { kind: "member" as const, id: "member-a" },
          memberStorage: a.memberStorage,
        };
        expect(await route.handle({ query: {}, body: { courseId } }, scope))
          .toEqual({ outcome: "created" });
        expect(await route.handle({ query: {}, body: { courseId } }, scope))
          .toEqual({ outcome: "already-enrolled" });
      } finally { await a.close(); }

      const other = createHostPluginMemberStorageSession(principal("pub-a", "member-a2", true), models, repo);
      const b = createHostPluginMemberStorageSession(principal("pub-b", "member-b", true), models, repo);
      try {
        expect(await other.memberStorage.get("enrollments", courseId)).toBeNull();
        expect(await b.memberStorage.get("enrollments", courseId)).toBeNull();
        await other.memberStorage.create("enrollments", courseId,
          { course_key: courseId, state: "active" });
        await b.memberStorage.create("enrollments", courseId,
          { course_key: courseId, state: "active" });
      } finally { await Promise.all([other.close(), b.close()]); }

      const counts = await client.query(`SELECT publication_id, member_id, count(*)::int AS n
        FROM plugin_member_records GROUP BY publication_id, member_id`);
      expect(counts.rows).toHaveLength(3);
      expect(counts.rows.every((row) => row.n === 1)).toBe(true);
      const audits = await client.query("SELECT action, metadata FROM audit_events");
      expect(audits.rows).toHaveLength(3);
      expect(JSON.stringify(audits.rows)).not.toContain("member-a");
      await client.query("UPDATE plugin_publication_states SET enabled=false WHERE publication_id='pub-b'");
      const inactive = createHostPluginMemberStorageSession(principal("pub-b", "member-b", false), models, repo);
      try {
        await expect(inactive.memberStorage.get("enrollments", courseId))
          .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      } finally { await inactive.close().catch(() => undefined); }
      // Disabling a site changes admission, never silently deletes stored data.
      const rows = await client.query("SELECT count(*)::int AS n FROM plugin_member_records");
      expect(rows.rows[0]?.n).toBe(3);
    } finally {
      await client.query("RESET search_path");
      if (schemaCreated) await client.query(`DROP SCHEMA IF EXISTS "${ns}" CASCADE`);
      client.release();
      await rm(r.directory, { recursive: true, force: true });
    }
  });
});
