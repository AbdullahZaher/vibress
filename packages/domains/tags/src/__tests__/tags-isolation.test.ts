import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications } from "@vibress/database";
import { DrizzleTagRepository } from "../infrastructure/drizzle-tag-repository";
import { TagsService } from "../application/tags-service";
import { TagDomainError } from "../domain/tag";

describe("Tags Multi-Publication Isolation", () => {
  let tagRepo: DrizzleTagRepository;
  let tagsService: TagsService;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();
  });

  beforeEach(() => {
    tagRepo = new DrizzleTagRepository();
    tagsService = new TagsService(tagRepo);
  });

  it("permits identical slugs across distinct publications (Same-slug requirement)", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";
    const commonSlug = "exclusive";

    const tagA = await tagsService.createTag(
      {
        name: "Exclusive Alpha",
        slug: commonSlug,
      },
      pubA,
    );

    const tagB = await tagsService.createTag(
      {
        name: "Exclusive Beta",
        slug: commonSlug,
      },
      pubB,
    );

    expect(tagA.publicationId).toBe(pubA);
    expect(tagB.publicationId).toBe(pubB);
    expect(tagA.slug).toBe(commonSlug);
    expect(tagB.slug).toBe(commonSlug);
    expect(tagA.id).not.toBe(tagB.id);

    const foundA = await tagsService.findBySlug(commonSlug, pubA);
    const foundB = await tagsService.findBySlug(commonSlug, pubB);

    expect(foundA?.id).toBe(tagA.id);
    expect(foundB?.id).toBe(tagB.id);
  });

  it("denies cross-publication read via non-disclosing null/404", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const tagA = await tagsService.createTag(
      {
        name: "Secret Tag",
      },
      pubA,
    );

    const foundFromB = await tagsService.findById(tagA.id, pubB);
    expect(foundFromB).toBeNull();
  });

  it("denies cross-publication update and delete", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const tagA = await tagsService.createTag(
      {
        name: "Protected Tag",
      },
      pubA,
    );

    await expect(
      tagsService.updateTag(tagA.id, { name: "Tampered" }, pubB),
    ).rejects.toThrow(TagDomainError);

    await expect(
      tagsService.deleteTag(tagA.id, pubB),
    ).rejects.toThrow(TagDomainError);

    const intactA = await tagsService.findById(tagA.id, pubA);
    expect(intactA?.name).toBe("Protected Tag");
  });

  it("filters listAll strictly by publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    await tagsService.createTag({ name: "ListTag Alpha" }, pubA);
    await tagsService.createTag({ name: "ListTag Beta" }, pubB);

    const listA = await tagsService.listAll(undefined, pubA);
    const listB = await tagsService.listAll(undefined, pubB);

    expect(listA.every((t) => t.publicationId === pubA)).toBe(true);
    expect(listB.every((t) => t.publicationId === pubB)).toBe(true);
  });
});
