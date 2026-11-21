import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { ContentModelerService } from "../application/content-modeler-service";
import { getDb, publications, workspaces, users, contentEntries, contentModels, outboxEvents } from "@vibress/database";
import { eq, inArray, sql } from "drizzle-orm";

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

  it("merges truly overlapping entry updates using the locked row without expectedVersion", async () => {
    const model = await service.createModel(
      {
        name: "Concurrent Updates",
        slug: "concurrent-updates",
        fields: [
          { id: "a", name: "A", key: "a", type: "text" },
          { id: "b", name: "B", key: "b", type: "text" },
        ],
      },
      pubA,
    );
    const entry = await service.createEntry(
      model.id, { title: "Concurrent", data: { a: "original", b: "original" } },
      testUserId, pubA,
    );
    const db = getDb();
    let releaseLock: () => void = () => {};
    let reportLock: () => void = () => {};
    let reportReads: () => void = () => {};
    const unlocked = new Promise<void>((resolve) => { releaseLock = resolve; });
    const lockReady = new Promise<void>((resolve) => { reportLock = resolve; });
    const readsReady = new Promise<void>((resolve) => { reportReads = resolve; });
    const holdingTransaction = db.transaction(async (tx) => {
      await tx.select({ id: contentEntries.id }).from(contentEntries)
        .where(eq(contentEntries.id, entry.id)).for("update");
      reportLock();
      await unlocked;
    });
    await lockReady;

    const originalGet = service.getEntryById.bind(service);
    let initialReads = 0;
    const spy = vi.spyOn(service, "getEntryById").mockImplementation(async (...args) => {
      const result = await originalGet(...args);
      if (result?.id === entry.id && result.version === 1 && ++initialReads === 2) {
        reportReads();
      }
      return result;
    });
    try {
      const first = service.updateEntry(model.id, entry.id, { data: { a: "first" } }, testUserId, pubA);
      const second = service.updateEntry(model.id, entry.id, { data: { b: "second" } }, testUserId, pubA);
      await readsReady; // both pre-lock reads observed version 1
      releaseLock();
      await Promise.all([first, second]);
      const stored = await originalGet(model.id, entry.id, pubA);
      expect(stored?.data).toMatchObject({ a: "first", b: "second" });
      expect(stored?.version).toBe(3);
    } finally {
      releaseLock();
      await holdingTransaction;
      spy.mockRestore();
    }
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

  it("writes the outbox event in the mutation transaction and rolls the mutation back if it fails", async () => {
    const db = getDb();
    const created = await service.createModel(
      { name: "Outbox Product", slug: "outbox-product", fields: [] },
      pubA,
    );
    const expectedId = createHash("sha256")
      .update(["VIBRESS-OUTBOX-EVENT-V1", "content_model.created", `model:${created.id}:created`].join("\u0000"))
      .digest("hex");
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, expectedId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: "content_model.created",
      status: "pending",
    });
    expect(rows[0]!.payload).toMatchObject({ modelId: created.id, slug: "outbox-product" });

    const failingSlug = "outbox-failing-slug";
    await db.execute(sql.raw(
      "CREATE FUNCTION cm_test_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cm_outbox_forced_failure'; END $$",
    ));
    await db.execute(sql.raw(
      "CREATE TRIGGER cm_test_reject_outbox BEFORE INSERT ON outbox_events FOR EACH ROW WHEN (NEW.payload->>'slug' = 'outbox-failing-slug') EXECUTE FUNCTION cm_test_reject_outbox()",
    ));
    try {
      await expect(
        service.createModel({ name: "Outbox Failing", slug: failingSlug, fields: [] }, pubA),
      ).rejects.toThrow(/outbox_events/);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER cm_test_reject_outbox ON outbox_events"));
      await db.execute(sql.raw("DROP FUNCTION cm_test_reject_outbox()"));
    }
    const orphan = await db
      .select()
      .from(contentModels)
      .where(eq(contentModels.slug, failingSlug));
    expect(orphan).toHaveLength(0);
  });
});
