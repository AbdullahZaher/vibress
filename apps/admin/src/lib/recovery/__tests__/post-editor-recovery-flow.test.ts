import { describe, it, expect, beforeEach } from "vitest";
import { indexedDbDraftStore } from "../indexed-db-draft-store";

describe("PostEditor Offline Draft Recovery Lifecycle", () => {
  const pubId = "pub_demo";
  const userId = "usr_writer_1";
  const postId = "post_crash_test";

  beforeEach(async () => {
    await indexedDbDraftStore.clearAll();
  });

  it("stores offline checkpoint on uncommitted edits and survives browser tab reload", async () => {
    // 1. Initial state: no recovery draft
    let draft = await indexedDbDraftStore.getDraft(pubId, userId, postId);
    expect(draft).toBeNull();

    // 2. User edits post offline
    const offlineContent = {
      root: {
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Offline investigative journalism draft." }],
          },
        ],
      },
    };
    const now = Date.now();

    await indexedDbDraftStore.saveDraft({
      publicationId: pubId,
      userId,
      postId,
      epoch: 1,
      baseVersion: 3,
      content: offlineContent,
      title: "Breaking News: Recovered Draft",
      updatedAt: now,
    });

    // 3. Browser reload: verify draft exists and contains uncommitted changes
    draft = await indexedDbDraftStore.getDraft(pubId, userId, postId);
    expect(draft).not.toBeNull();
    expect(draft?.title).toBe("Breaking News: Recovered Draft");
    expect(draft?.baseVersion).toBe(3);
    expect(draft?.updatedAt).toBe(now);

    // 4. User applies recovery: content is accepted and later saved to server
    // Upon clean server save, draft is purged from IndexedDB
    await indexedDbDraftStore.deleteDraft(pubId, userId, postId);
    draft = await indexedDbDraftStore.getDraft(pubId, userId, postId);
    expect(draft).toBeNull();
  });

  it("exports recovery draft payload as serialized JSON", async () => {
    const recoveryPayload = {
      publicationId: pubId,
      userId,
      postId,
      epoch: 2,
      baseVersion: 5,
      content: { root: { children: [] } },
      title: "Draft for Export",
      updatedAt: 1730900000000,
    };

    await indexedDbDraftStore.saveDraft(recoveryPayload);
    const draft = await indexedDbDraftStore.getDraft(pubId, userId, postId);
    expect(draft).not.toBeNull();

    const exportedJson = JSON.stringify(draft, null, 2);
    const parsed = JSON.parse(exportedJson);
    expect(parsed.title).toBe("Draft for Export");
    expect(parsed.baseVersion).toBe(5);
    expect(parsed.key).toBe(`${pubId}:${userId}:${postId}`);
  });
});
