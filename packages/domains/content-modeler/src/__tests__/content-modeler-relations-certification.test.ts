import { describe, it, expect, beforeAll } from "vitest";
import { ContentModelerService } from "../application/content-modeler-service";
import {
  validateEntryData,
  validateModelDefinition,
  filterEntryDataForVisibility,
  resolveLocalizedEntryData,
  MAX_RELATION_EXPANSION_DEPTH,
  MAX_RELATION_LIST_ITEMS,
  ValidationError,
} from "../domain/validation";
import {
  ContentModel,
  ContentEntry,
  ContentFieldDefinition,
} from "../domain/types";
import {
  getDb,
  publications,
  workspaces,
  users,
  contentEntries,
  contentModels,
} from "@vibress/database";
import { eq, inArray } from "drizzle-orm";

describe("Content Modeler — Relations & Relation List Comprehensive Certification Suite", () => {
  const service = new ContentModelerService();
  const pubTenantA = "pub_rel_tenant_a";
  const pubTenantB = "pub_rel_tenant_b";
  let testUserId = "usr_rel_admin";

  let authorModelA: ContentModel;
  let bookModelA: ContentModel;
  let courseModelA: ContentModel;
  let moduleModelA: ContentModel;
  let lessonModelA: ContentModel;

  let authorModelB: ContentModel;

  let author1A: ContentEntry;
  let author2A: ContentEntry;
  let author3A: ContentEntry;
  let authorB: ContentEntry;

  beforeAll(async () => {
    const db = getDb();

    // Setup test user
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@vibress.local"))
      .limit(1);

    if (userRows[0]) {
      testUserId = userRows[0].id;
    } else {
      await db
        .insert(users)
        .values({
          id: testUserId,
          email: "rel-admin@vibress.local",
          name: "Relation Admin",
          passwordHash: "dummy_rel_hash",
        })
        .onConflictDoNothing();
    }

    // Ensure test workspace
    await db
      .insert(workspaces)
      .values({
        id: "ws_rel_test",
        name: "Rel Workspace",
        slug: "rel-workspace",
      })
      .onConflictDoNothing();

    // Ensure test publications exist
    await db
      .insert(publications)
      .values([
        {
          id: pubTenantA,
          workspaceId: "ws_rel_test",
          name: "Publication Rel A",
          slug: "pub-rel-a",
        },
        {
          id: pubTenantB,
          workspaceId: "ws_rel_test",
          name: "Publication Rel B",
          slug: "pub-rel-b",
        },
      ])
      .onConflictDoNothing();

    // Clean up past relation models for clean run
    const existingModels = await db
      .select()
      .from(contentModels)
      .where(
        inArray(contentModels.publicationId, [pubTenantA, pubTenantB]),
      );
    for (const m of existingModels) {
      await db
        .delete(contentEntries)
        .where(eq(contentEntries.modelId, m.id));
      await db
        .delete(contentModels)
        .where(eq(contentModels.id, m.id));
    }

    // 1. Author Model in Tenant A
    authorModelA = await service.createModel(
      {
        name: "Authors",
        slug: "rel-authors",
        fields: [
          { id: "f1", name: "Name", key: "name", type: "short_text", required: true, localizable: true },
          { id: "f2", name: "Bio", key: "bio", type: "long_text" },
        ],
      },
      pubTenantA,
    );

    // 2. Author Model in Tenant B (for cross-tenant checks)
    authorModelB = await service.createModel(
      {
        name: "Authors B",
        slug: "rel-authors-b",
        fields: [
          { id: "fb1", name: "Name", key: "name", type: "short_text", required: true },
        ],
      },
      pubTenantB,
    );

    // 3. Book Model in Tenant A with single relation & relation_list
    bookModelA = await service.createModel(
      {
        name: "Books",
        slug: "rel-books",
        fields: [
          { id: "fb1", name: "Title", key: "title", type: "short_text", required: true },
          { id: "fb2", name: "Primary Author", key: "primaryAuthor", type: "relation", relationModel: authorModelA.id },
          { id: "fb3", name: "Contributing Authors", key: "coAuthors", type: "relation_list", relationModel: authorModelA.id },
        ],
      },
      pubTenantA,
    );

    // Create Authors in Tenant A
    author1A = await service.createEntry(
      authorModelA.id,
      {
        title: "Donald Knuth",
        slug: "donald-knuth",
        data: {
          name: { en: "Donald Knuth", ar: "دونالد كنوث" },
          bio: "Author of The Art of Computer Programming",
        },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    author2A = await service.createEntry(
      authorModelA.id,
      {
        title: "Leslie Lamport",
        slug: "leslie-lamport",
        data: {
          name: { en: "Leslie Lamport", ar: "ليزلي لامبورت" },
          bio: "Author of LaTeX and Paxos",
        },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    author3A = await service.createEntry(
      authorModelA.id,
      {
        title: "Edsger Dijkstra",
        slug: "edsger-dijkstra",
        data: {
          name: { en: "Edsger Dijkstra", ar: "إدسخر ديكسترا" },
          bio: "Pioneer in concurrent computing",
        },
        status: "draft", // DRAFT author to verify public filtering
      },
      testUserId,
      pubTenantA,
    );

    // Create Author in Tenant B
    authorB = await service.createEntry(
      authorModelB.id,
      {
        title: "Alan Turing",
        slug: "alan-turing",
        data: { name: "Alan Turing" },
        status: "published",
      },
      testUserId,
      pubTenantB,
    );
  });

  // Scenario 1: Valid relation_list creation & resolution
  it("Scenario 1: Creates and resolves a valid relation_list preserving data graph", async () => {
    const book = await service.createEntry(
      bookModelA.id,
      {
        title: "Algorithms & Logic",
        slug: "algo-logic",
        data: {
          title: "Algorithms & Logic",
          primaryAuthor: author1A.id,
          coAuthors: [author1A.id, author2A.id],
        },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    expect(book.data.primaryAuthor).toBe(author1A.id);
    expect(book.data.coAuthors).toEqual([author1A.id, author2A.id]);

    // Resolve relations at depth = 1
    const resolved = await service.resolveRelationsForEntry(
      book.data,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    expect(resolved.primaryAuthor).toMatchObject({
      id: author1A.id,
      title: "Donald Knuth",
      slug: "donald-knuth",
    });

    const coAuthorsResolved = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(Array.isArray(coAuthorsResolved)).toBe(true);
    expect(coAuthorsResolved.length).toBe(2);
    expect(coAuthorsResolved[0]!.title).toBe("Donald Knuth");
    expect(coAuthorsResolved[1]!.title).toBe("Leslie Lamport");
  });

  // Scenario 2: Empty relation_list
  it("Scenario 2: Handles empty relation_list gracefully as empty array", async () => {
    const book = await service.createEntry(
      bookModelA.id,
      {
        title: "Solo Project",
        slug: "solo-project",
        data: {
          title: "Solo Project",
          primaryAuthor: author1A.id,
          coAuthors: [],
        },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    const resolved = await service.resolveRelationsForEntry(
      book.data,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    expect(resolved.coAuthors).toEqual([]);
  });

  // Scenario 3 & 4: Maximum allowed list and oversized rejection
  it("Scenario 3 & 4: Accepts up to MAX_RELATION_LIST_ITEMS and strictly rejects oversized lists", () => {
    const maxAllowed = Array(MAX_RELATION_LIST_ITEMS).fill("entry_test_id");
    expect(() =>
      validateEntryData(
        { title: "Big Collection", coAuthors: maxAllowed },
        bookModelA.fields,
      ),
    ).not.toThrow();

    const oversized = Array(MAX_RELATION_LIST_ITEMS + 1).fill("entry_test_id");
    expect(() =>
      validateEntryData(
        { title: "Oversized Collection", coAuthors: oversized },
        bookModelA.fields,
      ),
    ).toThrow(ValidationError);
  });

  // Scenario 5: Wrong target model rejected on write
  it("Scenario 5: Rejects relation references targeting a wrong content model", async () => {
    const dummyBook = await service.createEntry(
      bookModelA.id,
      {
        title: "Target Book",
        data: { title: "Target Book" },
      },
      testUserId,
      pubTenantA,
    );

    await expect(
      service.createEntry(
        bookModelA.id,
        {
          title: "Invalid Model Target",
          data: {
            title: "Invalid Model Target",
            primaryAuthor: dummyBook.id, // Passing a book instead of an author
          },
        },
        testUserId,
        pubTenantA,
      ),
    ).rejects.toThrow(ValidationError);
  });

  // Scenario 6: Cross-publication target rejected on write & omitted on resolve
  it("Scenario 6: Blocks cross-publication references on write and omits them during resolution", async () => {
    // Attempting to save Tenant B's author in Tenant A's book
    await expect(
      service.createEntry(
        bookModelA.id,
        {
          title: "Cross Tenant Attack Book",
          data: {
            title: "Cross Tenant Attack Book",
            primaryAuthor: authorB.id,
          },
        },
        testUserId,
        pubTenantA,
      ),
    ).rejects.toThrow(ValidationError);

    // If cross-pub ID is in data, resolveRelationsForEntry returns null / omits it
    const maliciousData = {
      primaryAuthor: authorB.id,
      coAuthors: [authorB.id, author1A.id],
    };

    const resolved = await service.resolveRelationsForEntry(
      maliciousData,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    expect(resolved.primaryAuthor).toBeNull();
    const resolvedList = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(resolvedList.length).toBe(1);
    expect(resolvedList[0]!.id).toBe(author1A.id);
  });

  // Scenario 7: Deleted target handled safely
  it("Scenario 7: Safely resolves references when target entry has been soft-deleted", async () => {
    const tempAuthor = await service.createEntry(
      authorModelA.id,
      {
        title: "Temporary Author",
        slug: "temp-author",
        data: { name: "Temp" },
      },
      testUserId,
      pubTenantA,
    );

    await service.deleteEntry(authorModelA.id, tempAuthor.id, pubTenantA);

    const testData = {
      primaryAuthor: tempAuthor.id,
      coAuthors: [tempAuthor.id, author1A.id],
    };

    const resolved = await service.resolveRelationsForEntry(
      testData,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    expect(resolved.primaryAuthor).toBeNull();
    const resolvedCoAuthors = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(resolvedCoAuthors.length).toBe(1);
    expect(resolvedCoAuthors[0]!.id).toBe(author1A.id);
  });

  // Scenario 8 & 9: Unpublished target filtered for public role
  it("Scenario 8 & 9: Filters out unpublished related entries for public consumers", async () => {
    const testData = {
      primaryAuthor: author3A.id,
      coAuthors: [author1A.id, author3A.id],
    };

    const resolved = await service.resolveRelationsForEntry(
      testData,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    // Filter for public user role
    const publicFiltered = filterEntryDataForVisibility(
      resolved,
      bookModelA.fields,
      "public",
    );

    // Draft single relation should be null for public
    expect(publicFiltered.primaryAuthor).toBeNull();

    // Draft item in relation_list should be filtered out
    const publicCoAuthors = publicFiltered.coAuthors as Array<Record<string, unknown>>;
    expect(publicCoAuthors.length).toBe(1);
    expect(publicCoAuthors[0]!.id).toBe(author1A.id);

    // Staff admin can see draft related entries
    const staffFiltered = filterEntryDataForVisibility(
      resolved,
      bookModelA.fields,
      "staff_admin",
    );
    expect(staffFiltered.primaryAuthor).not.toBeNull();
    expect((staffFiltered.coAuthors as Array<unknown>).length).toBe(2);
  });

  // Scenario 10: Exact ordering preservation in relation_list
  it("Scenario 10: Strictly preserves the author's specified ordering in relation_list", async () => {
    const listForward = [author1A.id, author2A.id];
    const listReverse = [author2A.id, author1A.id];

    const resolvedForward = await service.resolveRelationsForEntry(
      { coAuthors: listForward },
      bookModelA.fields,
      pubTenantA,
      1,
    );

    const resolvedReverse = await service.resolveRelationsForEntry(
      { coAuthors: listReverse },
      bookModelA.fields,
      pubTenantA,
      1,
    );

    const fList = resolvedForward.coAuthors as Array<Record<string, unknown>>;
    const rList = resolvedReverse.coAuthors as Array<Record<string, unknown>>;

    expect(fList[0]!.id).toBe(author1A.id);
    expect(fList[1]!.id).toBe(author2A.id);

    expect(rList[0]!.id).toBe(author2A.id);
    expect(rList[1]!.id).toBe(author1A.id);
  });

  // Scenario 11: Duplicate IDs handling
  it("Scenario 11: Resolves multiple occurrences deterministically if duplicate IDs are provided", async () => {
    const duplicates = [author1A.id, author2A.id, author1A.id];
    const resolved = await service.resolveRelationsForEntry(
      { coAuthors: duplicates },
      bookModelA.fields,
      pubTenantA,
      1,
    );

    const list = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(list.length).toBe(3);
    expect(list[0]!.id).toBe(author1A.id);
    expect(list[1]!.id).toBe(author2A.id);
    expect(list[2]!.id).toBe(author1A.id);
  });

  // Scenario 12, 13, 14, 16: Multi-level nested relations & depth bounding (MAX_DEPTH = 2)
  it("Scenario 12, 13, 14, 16: Expands nested relations up to MAX_RELATION_EXPANSION_DEPTH = 2 and bounds depth", async () => {
    lessonModelA = await service.createModel(
      {
        name: "Lessons",
        slug: "rel-lessons",
        fields: [
          { id: "fl1", name: "Lesson Title", key: "lessonTitle", type: "short_text", required: true },
        ],
      },
      pubTenantA,
    );

    moduleModelA = await service.createModel(
      {
        name: "Modules",
        slug: "rel-modules",
        fields: [
          { id: "fm1", name: "Module Name", key: "moduleName", type: "short_text", required: true },
          { id: "fm2", name: "Lessons", key: "lessons", type: "relation_list", relationModel: lessonModelA.id },
        ],
      },
      pubTenantA,
    );

    courseModelA = await service.createModel(
      {
        name: "Courses",
        slug: "rel-courses",
        fields: [
          { id: "fc1", name: "Course Name", key: "courseName", type: "short_text", required: true },
          { id: "fc2", name: "Modules", key: "modules", type: "relation_list", relationModel: moduleModelA.id },
        ],
      },
      pubTenantA,
    );

    const lesson1 = await service.createEntry(
      lessonModelA.id,
      { title: "Intro to Types", data: { lessonTitle: "Intro to Types" }, status: "published" },
      testUserId,
      pubTenantA,
    );

    const module1 = await service.createEntry(
      moduleModelA.id,
      {
        title: "TypeScript Basics",
        data: { moduleName: "TypeScript Basics", lessons: [lesson1.id] },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    const course1 = await service.createEntry(
      courseModelA.id,
      {
        title: "Fullstack Architecture",
        data: { courseName: "Fullstack Architecture", modules: [module1.id] },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    // Expand at depth = 2 (Course -> Module -> Lesson)
    const resolvedDepth2 = await service.resolveRelationsForEntry(
      course1.data,
      courseModelA.fields,
      pubTenantA,
      2,
    );

    const courseModules = resolvedDepth2.modules as Array<Record<string, unknown>>;
    expect(courseModules.length).toBe(1);
    expect(courseModules[0]!.title).toBe("TypeScript Basics");

    const moduleLessons = (courseModules[0]!.data as Record<string, unknown>).lessons as Array<Record<string, unknown>>;
    expect(Array.isArray(moduleLessons)).toBe(true);
    expect(moduleLessons.length).toBe(1);
    expect(moduleLessons[0]!.title).toBe("Intro to Types");

    // Depth 1 should NOT expand level 2 (lessons remain raw ID strings)
    const resolvedDepth1 = await service.resolveRelationsForEntry(
      course1.data,
      courseModelA.fields,
      pubTenantA,
      1,
    );
    const depth1Modules = resolvedDepth1.modules as Array<Record<string, unknown>>;
    const rawLessons = (depth1Modules[0]!.data as Record<string, unknown>).lessons;
    expect(rawLessons).toEqual([lesson1.id]);
  });

  // Scenario 15: Circular relation cycle protection
  it("Scenario 15: Traverses cyclic relations safely without infinite loops or stack overflow", async () => {
    const circularDataA = {
      title: "Node A",
      coAuthors: [author1A.id],
    };

    // Simulate cyclic branch by pre-populating visited IDs
    const visited = new Set<string>([author1A.id]);
    const resolved = await service.resolveRelationsForEntry(
      circularDataA,
      bookModelA.fields,
      pubTenantA,
      2,
      visited,
    );

    const list = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(list.length).toBe(1);
    expect(list[0]!.cyclic).toBe(true);
  });

  // Scenario 17 & 20: Public DTO serialization and nested localization
  it("Scenario 17 & 20: Serializes public entry DTOs and resolves nested localized fields", async () => {
    const book = await service.createEntry(
      bookModelA.id,
      {
        title: "Structure & Interpretation",
        slug: "sicp",
        data: {
          title: "Structure & Interpretation",
          primaryAuthor: author1A.id,
          coAuthors: [author1A.id, author2A.id],
        },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    // Resolve relations
    book.data = await service.resolveRelationsForEntry(
      book.data,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    // Localize in Arabic
    const publicDtoAr = service.toPublicEntryDto(
      book,
      bookModelA,
      "public",
      "ar",
    );

    const primaryAuthor = publicDtoAr.data.primaryAuthor as Record<string, unknown>;
    expect((primaryAuthor.data as Record<string, unknown>).name).toBe("دونالد كنوث");

    const coAuthors = publicDtoAr.data.coAuthors as Array<Record<string, unknown>>;
    expect((coAuthors[0]!.data as Record<string, unknown>).name).toBe("دونالد كنوث");
    expect((coAuthors[1]!.data as Record<string, unknown>).name).toBe("ليزلي لامبورت");

    // Localize in English
    const publicDtoEn = service.toPublicEntryDto(
      book,
      bookModelA,
      "public",
      "en",
    );
    expect(((publicDtoEn.data.primaryAuthor as Record<string, unknown>).data as Record<string, unknown>).name).toBe("Donald Knuth");
  });

  // Scenario 23: Batched performance benchmark (zero N+1 queries)
  it("Scenario 23: Resolves 50 relation_list items in sub-25ms batched query time", async () => {
    const authorIds = [author1A.id, author2A.id];
    const largeList: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = authorIds[i % 2];
      if (id) largeList.push(id);
    }

    const startTime = performance.now();
    const resolved = await service.resolveRelationsForEntry(
      { coAuthors: largeList },
      bookModelA.fields,
      pubTenantA,
      1,
    );
    const duration = performance.now() - startTime;

    const list = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(list.length).toBe(50);
    expect(duration).toBeLessThan(25);
  });
});
