import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getDb, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleRedirectRepository } from "../src/infrastructure/drizzle-redirect-repository";

describe("redirect repository publication isolation", () => {
  const db = getDb();
  const repo = new DrizzleRedirectRepository();
  const suffix = randomUUID().slice(0, 12);
  const alpha = `redirect-alpha-${suffix}`;
  const beta = `redirect-beta-${suffix}`;

  beforeAll(async () => {
    await db.insert(publications).values([
      { id: alpha, workspaceId: "ws_default", name: "Redirect Alpha", slug: alpha, primaryLocale: "en" },
      { id: beta, workspaceId: "ws_default", name: "Redirect Beta", slug: beta, primaryLocale: "en" },
    ]);
  });

  afterAll(async () => {
    await db.delete(publications).where(inArray(publications.id, [alpha, beta]));
  });

  it("allows same source, enforces scoped reads, mutations, and enabled resolution", async () => {
    const a = await repo.create({source: "/same", destination: "/alpha"}, alpha);
    const b = await repo.create({source: "/same", destination: "/beta"}, beta);
    expect(a.publicationId).toBe(alpha);
    expect(b.publicationId).toBe(beta);

    expect(await repo.findById(a.id, beta)).toBeNull();
    expect(await repo.findById(a.id)).toBeNull();
    expect((await repo.findBySource("/same", alpha))?.id).toBe(a.id);
    expect((await repo.findBySource("/same", beta))?.id).toBe(b.id);

    expect((await repo.list(alpha)).map(r=>r.id)).toContain(a.id);
    expect((await repo.list(beta)).map(r=>r.id)).not.toContain(a.id);
    await expect(repo.update(a.id, {destination: "/stolen"}, beta)).rejects.toThrow(/not found/);
    expect((await repo.findById(a.id, alpha))?.destination).toBe("/alpha");
    await repo.delete(a.id, beta);
    expect(await repo.findById(a.id, alpha)).not.toBeNull();

    await repo.update(b.id, {enabled: false}, beta);
    expect((await repo.listEnabled(beta)).map(r=>r.id)).not.toContain(b.id);
    expect((await repo.listEnabled(alpha)).map(r=>r.id)).toContain(a.id);
  });
});
