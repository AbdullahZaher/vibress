import { describe, it, expect, beforeEach } from "vitest";
import { IndexedDbDraftStore } from "../indexed-db-draft-store";

describe("IndexedDbDraftStore offline crash recovery", () => {
  let store: IndexedDbDraftStore;

  beforeEach(() => {
    store = new IndexedDbDraftStore();
  });

  it("saves and retrieves offline draft record using memory fallback when IndexedDB is unavailable in Node", async () => {
    await store.saveDraft({
      publicationId: "pub_1",
      userId: "user_1",
      postId: "post_1",
      epoch: 1,
      baseVersion: 2,
      content: { root: { children: [{ type: "paragraph", children: [{ type: "text", text: "Offline draft" }] }] } },
      title: "My Offline Title",
      updatedAt: 1700000000000,
    });

    const retrieved = await store.getDraft("pub_1", "user_1", "post_1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe("My Offline Title");
    expect(retrieved?.baseVersion).toBe(2);
    expect(retrieved?.key).toBe("pub_1:user_1:post_1");
  });

  it("deletes offline draft upon successful save", async () => {
    await store.saveDraft({
      publicationId: "pub_1",
      userId: "user_1",
      postId: "post_2",
      epoch: 1,
      baseVersion: 1,
      content: { root: {} },
      title: "Temporary draft",
      updatedAt: 1700000000000,
    });

    let draft = await store.getDraft("pub_1", "user_1", "post_2");
    expect(draft).not.toBeNull();

    await store.deleteDraft("pub_1", "user_1", "post_2");
    draft = await store.getDraft("pub_1", "user_1", "post_2");
    expect(draft).toBeNull();
  });

  it("lists drafts isolated by publication and user", async () => {
    await store.saveDraft({
      publicationId: "pub_1",
      userId: "user_alice",
      postId: "post_a",
      epoch: 1,
      baseVersion: 1,
      content: {},
      title: "Alice Doc A",
      updatedAt: 100,
    });
    await store.saveDraft({
      publicationId: "pub_1",
      userId: "user_bob",
      postId: "post_b",
      epoch: 1,
      baseVersion: 1,
      content: {},
      title: "Bob Doc B",
      updatedAt: 200,
    });

    const aliceDrafts = await store.listDraftsForUser("pub_1", "user_alice");
    expect(aliceDrafts.length).toBe(1);
    expect(aliceDrafts[0]?.title).toBe("Alice Doc A");
  });
});
