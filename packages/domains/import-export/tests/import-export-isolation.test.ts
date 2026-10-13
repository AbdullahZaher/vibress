import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getDb, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleImportExportJobRepository } from "../src/infrastructure/drizzle-job-repository";

describe("Import/export repository publication isolation", () => {
  const db = getDb();
  const repo = new DrizzleImportExportJobRepository();
  const suffix = randomUUID().slice(0, 12);
  const alpha = `ie-alpha-${suffix}`;
  const beta = `ie-beta-${suffix}`;

  beforeAll(async () => {
    await db.insert(publications).values([
      { id: alpha, workspaceId: "ws_default", name: "Import Alpha", slug: alpha, primaryLocale: "en" },
      { id: beta, workspaceId: "ws_default", name: "Import Beta", slug: beta, primaryLocale: "en" },
    ]);
  });

  afterAll(async () => {
    await db.delete(publications).where(inArray(publications.id, [alpha, beta]));
  });

  it("isolates finds, counts, and status updates even when ids are known", async () => {
    const alphaJob = await repo.create({ type: "export", requestedBy: null, publicationId: alpha });
    const betaJob = await repo.create({ type: "import", requestedBy: null, publicationId: beta });
    expect(alphaJob.publicationId).toBe(alpha);
    expect(betaJob.publicationId).toBe(beta);

    expect(await repo.findById(alphaJob.id, beta)).toBeNull();
    expect(await repo.findById(alphaJob.id)).toBeNull(); // legacy call defaults to pub_default
    expect((await repo.findById(alphaJob.id, alpha))?.id).toBe(alphaJob.id);

    const alphaJobs = await repo.list({ publicationId: alpha });
    const betaJobs = await repo.list({ publicationId: beta });
    expect(alphaJobs.jobs.some(j => j.id === alphaJob.id)).toBe(true);
    expect(alphaJobs.jobs.some(j => j.id === betaJob.id)).toBe(false);
    expect(betaJobs.jobs.some(j => j.id === betaJob.id)).toBe(true);
    expect(betaJobs.jobs.some(j => j.id === alphaJob.id)).toBe(false);
    const implicitDefault = await repo.list();
    expect(implicitDefault.jobs.some(j => j.id === alphaJob.id)).toBe(false);

    await repo.updateStatus(alphaJob.id, "completed", undefined, beta);
    expect((await repo.findById(alphaJob.id, alpha))?.status).toBe("pending");
    await repo.updateStatus(alphaJob.id, "completed", undefined, alpha);
    expect((await repo.findById(alphaJob.id, alpha))?.status).toBe("completed");
  });
});
