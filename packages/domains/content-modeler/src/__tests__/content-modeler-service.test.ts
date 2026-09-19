import { describe, it, expect, beforeAll } from "vitest";
import { ContentModelerService } from "../application/content-modeler-service";
import { getDb, publications, workspaces, users, contentEntries, contentModels } from "@vibress/database";
import { eq, inArray } from "drizzle-orm";

describe("ContentModelerService Publication Scoping and Relations", () => {
  const service = new ContentModelerService();
  const pubA = "pub_cm_test_a";
  const pubB = "pub_cm_test_b";
  let testUserId = "usr_cm_test_user";

  beforeAll(async () => {
    const db = getDb();

    // Query existing admin user
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@vibress.local"))
      .limit(1);

    if (userRows[0]) {
      testUserId = userRows[0].id;
    } else {
      // Create user with required passwordHash
      const newId = "usr_cm_test_user";
      await db
        .insert(users)
        .values({
          id: newId,
          email: "cm-test@vibress.local",
          name: "CM Tester",
          passwordHash: "dummy_hash_12345",
        })
        .onConflictDoNothing();
      testUserId = newId;
    }

    // Clean any prior test data for these test publications
    await db.delete(contentEntries).where(inArray(contentEntries.publicationId, [pubA, pubB]));
    await db.delete(contentModels).where(inArray(contentModels.publicationId, [pubA, pubB]));

    // Ensure workspace exists
    await db
      .insert(workspaces)
      .values({
        id: "ws_cm_test",
        name: "Content Modeler Test WS",
        slug: "cm-test-ws",
      })
      .onConflictDoNothing();

    // Ensure publication A and B exist
    await db
      .insert(publications)
      .values([
        {
          id: pubA,
          workspaceId: "ws_cm_test",
          name: "Publication Alpha",
          slug: "pub-alpha",
          primaryLocale: "en",
        },
        {
          id: pubB,
          workspaceId: "ws_cm_test",
          name: "Publication Beta",
          slug: "pub-beta",
          primaryLocale: "ar",
        },
      ])
      .onConflictDoNothing();
  });

  it("creates models scoped to distinct publications and prevents cross-pub access", async () => {
    const modelA = await service.createModel(
      {
        name: "Alpha Product",
        slug: "product",
        fields: [
          { id: "f1", name: "Product Name", key: "name", type: "text", required: true },
          { id: "f2", name: "Price", key: "price", type: "number", required: true },
        ],
      },
      pubA,
    );

    const modelB = await service.createModel(
      {
        name: "Beta Product",
        slug: "product", // Same slug allowed across different publications!
        fields: [
          { id: "fb1", name: "Item Title", key: "title", type: "text", required: true },
        ],
      },
      pubB,
    );

    expect(modelA.id).toBeDefined();
    expect(modelA.publicationId).toBe(pubA);
    expect(modelB.id).toBeDefined();
    expect(modelB.publicationId).toBe(pubB);

    // Pub A cannot read Pub B's model by ID
    const crossRead = await service.getModelByIdOrSlug(modelB.id, pubA);
    expect(crossRead).toBeNull();

    // Pub A cannot read Pub B's model by slug
    const modelInA = await service.getModelByIdOrSlug("product", pubA);
    expect(modelInA?.id).toBe(modelA.id);
    expect(modelInA?.name).toBe("Alpha Product");

    const modelInB = await service.getModelByIdOrSlug("product", pubB);
    expect(modelInB?.id).toBe(modelB.id);
    expect(modelInB?.name).toBe("Beta Product");
  });

  it("creates entries strictly scoped to publication and prevents cross-pub mutation", async () => {
    const modelA = await service.getModelByIdOrSlug("product", pubA);
    expect(modelA).not.toBeNull();

    const entryA = await service.createEntry(
      modelA!.id,
      {
        title: "Gadget A",
        slug: "gadget-a",
        data: { name: "Gadget A", price: 49.99 },
        status: "published",
      },
      testUserId,
      pubA,
    );

    expect(entryA.publicationId).toBe(pubA);

    // Pub B cannot read entryA
    const entryFromB = await service.getEntryById(modelA!.id, entryA.id, pubB);
    expect(entryFromB).toBeNull();

    // Pub B cannot update entryA
    await expect(
      service.updateEntry(
        modelA!.id,
        entryA.id,
        { title: "Hacked by B" },
        testUserId,
        pubB,
      ),
    ).rejects.toThrow();
  });

  it("supports entry lifecycle: draft -> publish -> unpublish -> archive", async () => {
    const modelA = await service.getModelByIdOrSlug("product", pubA);
    const entry = await service.createEntry(
      modelA!.id,
      {
        title: "Lifecycle Item",
        slug: "lifecycle-item",
        data: { name: "Lifecycle Item", price: 10 },
        status: "draft",
      },
      testUserId,
      pubA,
    );

    expect(entry.status).toBe("draft");
    expect(entry.publishedAt).toBeNull();

    const published = await service.publishEntry(modelA!.id, entry.id, testUserId, pubA);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    const unpublished = await service.unpublishEntry(modelA!.id, entry.id, testUserId, pubA);
    expect(unpublished.status).toBe("draft");

    const archived = await service.archiveEntry(modelA!.id, entry.id, testUserId, pubA);
    expect(archived.status).toBe("archived");
  });

  it("resolves relations safely within publication and prevents cross-pub relation leakage", async () => {
    // 1. Create Author Model in Pub A
    const authorModel = await service.createModel(
      {
        name: "Author",
        slug: "author",
        fields: [
          { id: "fa1", name: "Author Name", key: "authorName", type: "text", required: true },
        ],
      },
      pubA,
    );

    // 2. Create Book Model in Pub A referencing Author
    const bookModel = await service.createModel(
      {
        name: "Book",
        slug: "book",
        fields: [
          { id: "fb1", name: "Book Title", key: "bookTitle", type: "text", required: true },
          { id: "fb2", name: "Author", key: "author", type: "relation", relationModel: authorModel.id },
        ],
      },
      pubA,
    );

    const authorEntry = await service.createEntry(
      authorModel.id,
      {
        title: "Tariq Ali",
        slug: "tariq-ali",
        data: { authorName: "Tariq Ali" },
        status: "published",
      },
      testUserId,
      pubA,
    );

    const bookEntry = await service.createEntry(
      bookModel.id,
      {
        title: "Shadows of the Pomegranate Tree",
        slug: "shadows-tree",
        data: {
          bookTitle: "Shadows of the Pomegranate Tree",
          author: authorEntry.id,
        },
        status: "published",
      },
      testUserId,
      pubA,
    );

    // Retrieve book with resolved relations in Pub A
    const resolvedBook = await service.getEntryById(bookModel.id, bookEntry.id, pubA, true);
    expect(resolvedBook).not.toBeNull();
    expect(resolvedBook?.data.author).toBeDefined();
    expect((resolvedBook?.data.author as any).title).toBe("Tariq Ali");

    // Pub B resolving relations cannot see Pub A author
    const bookInB = await service.getEntryById(bookModel.id, bookEntry.id, pubB, true);
    expect(bookInB).toBeNull();
  });
});
