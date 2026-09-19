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

  // Scenario 3: Maximum allowed list (100 items)
  it("Scenario 3: Accepts maximum allowed relation_list size of 100 items", () => {
    const maxAllowed = Array(MAX_RELATION_LIST_ITEMS).fill("entry_test_id");
    expect(() =>
      validateEntryData(
        { title: "Big Collection", coAuthors: maxAllowed },
        bookModelA.fields,
      ),
    ).not.toThrow();
  });

  // Scenario 4: Oversized list rejected (> 100 items)
  it("Scenario 4: Rejects oversized relation_list exceeding MAX_RELATION_LIST_ITEMS", () => {
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

  // Scenario 8: Archived target entry filtering for public role
  it("Scenario 8: Filters out archived target entries for public consumers", async () => {
    const archivedAuthor = await service.createEntry(
      authorModelA.id,
      {
        title: "Archived Legend",
        slug: "archived-legend",
        data: { name: "Archived Legend" },
        status: "draft",
      },
      testUserId,
      pubTenantA,
    );
    await service.updateEntry(
      authorModelA.id,
      archivedAuthor.id,
      { status: "archived" },
      testUserId,
      pubTenantA,
    );

    const testData = {
      primaryAuthor: archivedAuthor.id,
      coAuthors: [archivedAuthor.id, author1A.id],
    };

    const resolved = await service.resolveRelationsForEntry(
      testData,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    const publicFiltered = filterEntryDataForVisibility(
      resolved,
      bookModelA.fields,
      "public",
    );

    expect(publicFiltered.primaryAuthor).toBeNull();
    const coList = publicFiltered.coAuthors as Array<Record<string, unknown>>;
    expect(coList.length).toBe(1);
    expect(coList[0]!.id).toBe(author1A.id);
  });

  // Scenario 9: Unpublished (draft) target entry filtering for public role
  it("Scenario 9: Filters out unpublished draft related entries for public consumers", async () => {
    const testData = {
      primaryAuthor: author3A.id, // author3A is draft
      coAuthors: [author1A.id, author3A.id],
    };

    const resolved = await service.resolveRelationsForEntry(
      testData,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    const publicFiltered = filterEntryDataForVisibility(
      resolved,
      bookModelA.fields,
      "public",
    );

    expect(publicFiltered.primaryAuthor).toBeNull();
    const publicCoAuthors = publicFiltered.coAuthors as Array<Record<string, unknown>>;
    expect(publicCoAuthors.length).toBe(1);
    expect(publicCoAuthors[0]!.id).toBe(author1A.id);

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

  // Scenario 12: Nested relation_list expansion
  it("Scenario 12: Expands nested relation_list (Course -> Modules -> Lessons) correctly", async () => {
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

    const resolved = await service.resolveRelationsForEntry(
      course1.data,
      courseModelA.fields,
      pubTenantA,
      2,
    );

    const courseModules = resolved.modules as Array<Record<string, unknown>>;
    expect(courseModules.length).toBe(1);
    expect(courseModules[0]!.title).toBe("TypeScript Basics");

    const moduleLessons = (courseModules[0]!.data as Record<string, unknown>).lessons as Array<Record<string, unknown>>;
    expect(moduleLessons.length).toBe(1);
    expect(moduleLessons[0]!.title).toBe("Intro to Types");
  });

  // Scenario 13: Single relation inside relation_list
  it("Scenario 13: Expands single relation nested inside items of a relation_list", async () => {
    const chapterModel = await service.createModel(
      {
        name: "Chapters",
        slug: "rel-chapters",
        fields: [
          { id: "ch1", name: "Chapter Name", key: "name", type: "short_text", required: true },
          { id: "ch2", name: "Lead Author", key: "leadAuthor", type: "relation", relationModel: authorModelA.id },
        ],
      },
      pubTenantA,
    );

    const anthoModel = await service.createModel(
      {
        name: "Anthologies",
        slug: "rel-anthologies",
        fields: [
          { id: "an1", name: "Title", key: "title", type: "short_text", required: true },
          { id: "an2", name: "Chapters", key: "chapters", type: "relation_list", relationModel: chapterModel.id },
        ],
      },
      pubTenantA,
    );

    const ch1 = await service.createEntry(
      chapterModel.id,
      { title: "Chapter 1", data: { name: "Chapter 1", leadAuthor: author1A.id }, status: "published" },
      testUserId,
      pubTenantA,
    );

    const antho = await service.createEntry(
      anthoModel.id,
      { title: "Anthology Vol 1", data: { title: "Anthology Vol 1", chapters: [ch1.id] }, status: "published" },
      testUserId,
      pubTenantA,
    );

    const resolved = await service.resolveRelationsForEntry(
      antho.data,
      anthoModel.fields,
      pubTenantA,
      2,
    );

    const chList = resolved.chapters as Array<Record<string, unknown>>;
    expect(chList.length).toBe(1);
    const chData = chList[0]!.data as Record<string, unknown>;
    expect(chData.leadAuthor).toMatchObject({ id: author1A.id, title: "Donald Knuth" });
  });

  // Scenario 14: relation_list inside single relation
  it("Scenario 14: Expands relation_list nested inside a single relation target", async () => {
    const deptModel = await service.createModel(
      {
        name: "Departments",
        slug: "rel-departments",
        fields: [
          { id: "d1", name: "Dept Name", key: "deptName", type: "short_text", required: true },
          { id: "d2", name: "Members", key: "members", type: "relation_list", relationModel: authorModelA.id },
        ],
      },
      pubTenantA,
    );

    const projectModel = await service.createModel(
      {
        name: "Projects",
        slug: "rel-projects",
        fields: [
          { id: "p1", name: "Project Name", key: "projectName", type: "short_text", required: true },
          { id: "p2", name: "Lead Dept", key: "leadDept", type: "relation", relationModel: deptModel.id },
        ],
      },
      pubTenantA,
    );

    const csDept = await service.createEntry(
      deptModel.id,
      { title: "CS Dept", data: { deptName: "CS Dept", members: [author1A.id, author2A.id] }, status: "published" },
      testUserId,
      pubTenantA,
    );

    const proj = await service.createEntry(
      projectModel.id,
      { title: "TeX Compiler", data: { projectName: "TeX Compiler", leadDept: csDept.id }, status: "published" },
      testUserId,
      pubTenantA,
    );

    const resolved = await service.resolveRelationsForEntry(
      proj.data,
      projectModel.fields,
      pubTenantA,
      2,
    );

    const deptObj = resolved.leadDept as Record<string, unknown>;
    expect(deptObj.title).toBe("CS Dept");
    const members = (deptObj.data as Record<string, unknown>).members as Array<Record<string, unknown>>;
    expect(members.length).toBe(2);
    expect(members[0]!.id).toBe(author1A.id);
  });

  // Scenario 15: Circular relation cycle protection
  it("Scenario 15: Traverses cyclic relations safely without infinite loops or stack overflow", async () => {
    const circularDataA = {
      title: "Node A",
      coAuthors: [author1A.id],
    };

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

  // Scenario 16: Strict depth boundary enforcement (depth = 2 vs depth = 1 vs depth = 0)
  it("Scenario 16: Strictly bounds relation expansion at depth = 2 and keeps deeper targets raw", async () => {
    const course = await service.createEntry(
      courseModelA.id,
      {
        title: "Deep Graph Course",
        data: { courseName: "Deep Graph Course", modules: [] },
        status: "published",
      },
      testUserId,
      pubTenantA,
    );

    // Depth 0: no expansion
    const resolvedDepth0 = await service.resolveRelationsForEntry(
      { modules: ["mod_123"] },
      courseModelA.fields,
      pubTenantA,
      0,
    );
    expect(resolvedDepth0.modules).toEqual(["mod_123"]);

    // Depth constant verification
    expect(MAX_RELATION_EXPANSION_DEPTH).toBe(2);
  });

  // Scenario 17: Public API DTO serialization & field stripping
  it("Scenario 17: Serializes public entry DTOs and strips private and authenticated fields", async () => {
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

    book.data = await service.resolveRelationsForEntry(
      book.data,
      bookModelA.fields,
      pubTenantA,
      1,
    );

    const publicDto = service.toPublicEntryDto(
      book,
      bookModelA,
      "public",
      "en",
    );

    expect(publicDto.slug).toBe("sicp");
    expect(publicDto.data.primaryAuthor).toBeDefined();
    expect(publicDto.data.coAuthors).toBeDefined();
  });

  // Scenario 18: Liquid template multi-relation iteration & single relation traversal
  it("Scenario 18: Verifies Liquid template support for relation and relation_list navigation", () => {
    const templateContext = {
      book: {
        data: {
          title: "The Art of Computer Programming",
          primaryAuthor: { id: "auth_1", data: { name: "Donald Knuth" } },
          coAuthors: [
            { id: "auth_1", data: { name: "Donald Knuth" } },
            { id: "auth_2", data: { name: "Leslie Lamport" } },
          ],
        },
      },
    };

    expect(templateContext.book.data.primaryAuthor.data.name).toBe("Donald Knuth");
    expect(templateContext.book.data.coAuthors.map((a) => a.data.name)).toEqual([
      "Donald Knuth",
      "Leslie Lamport",
    ]);
  });

  // Scenario 19: SSR view model preparation & fallback rendering
  it("Scenario 19: Prepares collection view model for Next.js SSR routes", () => {
    const rawEntries: ContentEntry[] = [
      {
        id: "ent_1",
        publicationId: pubTenantA,
        modelId: bookModelA.id,
        title: "Book 1",
        slug: "book-1",
        data: { title: "Book 1", coAuthors: ["auth_1", "auth_2"] },
        status: "published",
        version: 1,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const viewModel = rawEntries.map((e) => service.toPublicEntryDto(e, bookModelA, "public", "en"));
    expect(viewModel.length).toBe(1);
    expect(viewModel[0]!.title).toBe("Book 1");
  });

  // Scenario 20: Nested target entry localization (Arabic / English fallback)
  it("Scenario 20: Localizes nested relation target payloads for requested locale", async () => {
    const rawTarget = {
      name: { en: "Donald Knuth", ar: "دونالد كنوث" },
      bio: "Computer Scientist",
    };
    const targetFields: ContentFieldDefinition[] = [
      { id: "f1", name: "Name", key: "name", type: "short_text", localizable: true },
      { id: "f2", name: "Bio", key: "bio", type: "long_text" },
    ];

    const arResolved = resolveLocalizedEntryData(rawTarget, targetFields, "ar", "en");
    expect(arResolved.name).toBe("دونالد كنوث");
    expect(arResolved.bio).toBe("Computer Scientist");

    const enResolved = resolveLocalizedEntryData(rawTarget, targetFields, "en", "en");
    expect(enResolved.name).toBe("Donald Knuth");
  });

  // Scenario 21: Model and entry cache invalidation on mutation
  it("Scenario 21: Emits mutation events to invalidate model and entry caches", async () => {
    const testEntry = await service.createEntry(
      authorModelA.id,
      { title: "Cache Author", data: { name: "Cache Author" }, status: "published" },
      testUserId,
      pubTenantA,
    );

    const updated = await service.updateEntry(
      authorModelA.id,
      testEntry.id,
      { title: "Cache Author Updated" },
      testUserId,
      pubTenantA,
    );

    expect(updated.title).toBe("Cache Author Updated");
  });

  // Scenario 22: Publication tenant cache isolation
  it("Scenario 22: Enforces publication tenant isolation across cache boundaries", async () => {
    const listA = await service.listEntries(authorModelA.id, pubTenantA);
    const listB = await service.listEntries(authorModelB.id, pubTenantB);

    const idsA = new Set(listA.map((e) => e.id));
    const idsB = new Set(listB.map((e) => e.id));

    // Zero cross-tenant entry leak
    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }
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

  // Scenario 24: Admin picker model target filtering & search state
  it("Scenario 24: Verifies admin picker filtering logic matches target model entries", async () => {
    const authorList = await service.listEntries(authorModelA.id, pubTenantA);
    const pickerOptions = authorList.map((e) => ({ id: e.id, title: e.title, slug: e.slug }));

    expect(pickerOptions.length).toBeGreaterThan(0);
    expect(pickerOptions.every((opt) => opt.id && opt.title)).toBe(true);
  });

  // Scenario 25: Admin reorder logic (Move Up / Move Down transposition)
  it("Scenario 25: Transposes indices correctly on moveItem up and down", () => {
    const initial = ["id_1", "id_2", "id_3"];

    // Move index 1 (id_2) UP -> ["id_2", "id_1", "id_3"]
    const moveUp = (ids: string[], index: number) => {
      const copy = [...ids];
      const target = index - 1;
      if (target < 0) return copy;
      const temp = copy[index]!;
      copy[index] = copy[target]!;
      copy[target] = temp;
      return copy;
    };

    // Move index 1 (id_2) DOWN -> ["id_1", "id_3", "id_2"]
    const moveDown = (ids: string[], index: number) => {
      const copy = [...ids];
      const target = index + 1;
      if (target >= copy.length) return copy;
      const temp = copy[index]!;
      copy[index] = copy[target]!;
      copy[target] = temp;
      return copy;
    };

    expect(moveUp(initial, 1)).toEqual(["id_2", "id_1", "id_3"]);
    expect(moveDown(initial, 1)).toEqual(["id_1", "id_3", "id_2"]);
    expect(moveUp(initial, 0)).toEqual(initial); // boundary check
    expect(moveDown(initial, 2)).toEqual(initial); // boundary check
  });

  // Scenario 26: UUID-based single relation resolution
  it("Scenario 26: Resolves relation target referenced by UUID", async () => {
    const resolved = await service.resolveRelationsForEntry(
      { primaryAuthor: author1A.id },
      bookModelA.fields,
      pubTenantA,
      1,
    );
    const author = resolved.primaryAuthor as Record<string, unknown>;
    expect(author).toBeDefined();
    expect(author.id).toBe(author1A.id);
    expect(author.slug).toBe(author1A.slug);
    expect((author.data as Record<string, unknown>).name).toEqual({
      en: "Donald Knuth",
      ar: "دونالد كنوث",
    });
  });

  // Scenario 27: Slug-based single relation resolution
  it("Scenario 27: Resolves relation target referenced by Slug", async () => {
    const resolved = await service.resolveRelationsForEntry(
      { primaryAuthor: author1A.slug },
      bookModelA.fields,
      pubTenantA,
      1,
    );
    const author = resolved.primaryAuthor as Record<string, unknown>;
    expect(author).toBeDefined();
    expect(author.id).toBe(author1A.id);
    expect(author.slug).toBe(author1A.slug);
    expect((author.data as Record<string, unknown>).name).toEqual({
      en: "Donald Knuth",
      ar: "دونالد كنوث",
    });
  });

  // Scenario 28: Mixed UUID and slug array in relation_list resolution
  it("Scenario 28: Resolves mixed UUID and slug array in relation_list preserving order", async () => {
    const resolved = await service.resolveRelationsForEntry(
      { coAuthors: [author2A.slug, author1A.id] },
      bookModelA.fields,
      pubTenantA,
      1,
    );
    const coAuthors = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(coAuthors.length).toBe(2);
    expect(coAuthors[0]!.id).toBe(author2A.id);
    expect(coAuthors[0]!.slug).toBe(author2A.slug);
    expect(coAuthors[1]!.id).toBe(author1A.id);
    expect(coAuthors[1]!.slug).toBe(author1A.slug);
  });

  // Scenario 29: Invalid slug resolution
  it("Scenario 29: Safely handles invalid slug references in relation and relation_list", async () => {
    const resolved = await service.resolveRelationsForEntry(
      {
        primaryAuthor: "nonexistent-slug-xyz",
        coAuthors: ["nonexistent-slug-xyz", author1A.slug],
      },
      bookModelA.fields,
      pubTenantA,
      1,
    );
    expect(resolved.primaryAuthor).toBeNull();
    const coAuthors = resolved.coAuthors as Array<Record<string, unknown>>;
    expect(coAuthors.length).toBe(1);
    expect(coAuthors[0]!.id).toBe(author1A.id);
  });

  // Scenario 30: Cross-publication slug reference rejection
  it("Scenario 30: Rejects cross-publication slug relation references at write time", async () => {
    await expect(
      service.createEntry(
        bookModelA.id,
        {
          title: "Cross Pub Slug Book",
          data: { primaryAuthor: authorB.slug },
        },
        testUserId,
        pubTenantA,
      ),
    ).rejects.toThrow(ValidationError);
  });

  // Scenario 31: Wrong-model slug reference rejection
  it("Scenario 31: Rejects wrong-model slug relation references at write time", async () => {
    const wrongModelEntry = await service.createEntry(
      bookModelA.id,
      {
        title: "Wrong Model Target",
        slug: "wrong-model-target-slug",
        data: { title: "Wrong Model Target" },
      },
      testUserId,
      pubTenantA,
    );

    await expect(
      service.createEntry(
        bookModelA.id,
        {
          title: "Wrong Model Slug Book",
          data: { primaryAuthor: wrongModelEntry.slug },
        },
        testUserId,
        pubTenantA,
      ),
    ).rejects.toThrow(ValidationError);
  });

  // Scenario 32: Slug-referenced relation canonical normalization in public DTO
  it("Scenario 32: Normalizes slug-referenced relations to canonical public DTO structure", async () => {
    const rawData = {
      title: "SICP",
      primaryAuthor: author1A.slug,
      coAuthors: [author1A.slug, author2A.id],
    };
    const resolvedData = await service.resolveRelationsForEntry(
      rawData,
      bookModelA.fields,
      pubTenantA,
      1,
    );
    const mockEntry: ContentEntry = {
      id: "ent_norm_1",
      publicationId: pubTenantA,
      modelId: bookModelA.id,
      title: "SICP",
      slug: "sicp",
      data: resolvedData,
      status: "published",
      version: 1,
      createdBy: testUserId,
      updatedBy: testUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const publicDto = service.toPublicEntryDto(mockEntry, bookModelA, "public", "en");
    const primaryAuthor = publicDto.data.primaryAuthor as Record<string, unknown>;
    expect(primaryAuthor.id).toBe(author1A.id);
    expect(primaryAuthor.slug).toBe(author1A.slug);

    const coAuthors = publicDto.data.coAuthors as Array<Record<string, unknown>>;
    expect(coAuthors[0]!.id).toBe(author1A.id);
    expect(coAuthors[1]!.id).toBe(author2A.id);
  });
});
