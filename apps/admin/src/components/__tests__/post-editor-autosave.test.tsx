/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostEditor } from "../PostEditor";
import { apiRequest, ApiError } from "../../lib/api";
import { createDefaultStudioDocument } from "@vibress/studio-core";

vi.mock("../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (text: string) => text }),
}));

vi.mock("../../lib/api", () => ({
  apiRequest: vi.fn(),
  uploadMediaApi: vi.fn(),
  fetchAiStatus: vi.fn(async () => ({ enabled: false })),
  generateAiCompletion: vi.fn(),
  ApiError: class ApiError extends Error {
    statusCode: number;
    code: string;
    constructor(code: string, message: string, statusCode = 409) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("@vibress/studio-react", () => ({
  VibressStudio: ({ onChange }: { onChange: (doc: unknown) => void }) => (
    <div>
      <button data-testid="edit-a" onClick={() => onChange({
        schema: "vibress-studio", version: 1,
        root: { type: "root", children: [
          { type: "paragraph", children: [{ type: "text", text: "Draft A", version: 1 }], version: 1 },
        ], version: 1 },
      })}>Edit A</button>
      <button data-testid="edit-b" onClick={() => onChange({
        schema: "vibress-studio", version: 1,
        root: { type: "root", children: [
          { type: "paragraph", children: [{ type: "text", text: "Draft B", version: 1 }], version: 1 },
        ], version: 1 },
      })}>Edit B</button>
    </div>
  ),
  WebSocketCollaborationProvider: class {},
  YDoc: class {},
}));

vi.mock("../editor/PostSettingsSidebar", () => ({
  PostSettingsSidebar: ({ setExcerpt, setSelectedTagIds, handleRestoreRevision }: {
    setExcerpt: (value: string) => void;
    setSelectedTagIds: (ids: string[]) => void;
    handleRestoreRevision: (id: string) => Promise<void>;
  }) => <div>
    <button data-testid="restore-revision" onClick={() => { void handleRestoreRevision("revision-1"); }}>Restore</button>
    <button data-testid="change-excerpt" onClick={() => setExcerpt("New excerpt")}>Excerpt edit</button>
    <button data-testid="change-tags" onClick={() => setSelectedTagIds(["tag-1"])}>Tag edit</button>
  </div>,
}));
vi.mock("../editor/EditorialCollaborationPanel", () => ({ EditorialCollaborationPanel: () => null }));
vi.mock("../editor/RevisionDiffModal", () => ({ RevisionDiffModal: () => null }));
vi.mock("../editor/PostFeatureImageControl", () => ({
  PostFeatureImageControl: ({ onOpenMediaPicker, onUpdateAltAndCaption, featureImage }: {
    onOpenMediaPicker: () => void;
    onUpdateAltAndCaption: (alt: string, caption: string) => void;
    featureImage: { id: string } | null;
  }) => <div>
    <button data-testid="open-feature-picker" onClick={onOpenMediaPicker}>Choose feature</button>
    <button data-testid="feature-alt-a" onClick={() => onUpdateAltAndCaption("Alt A", "")}>Alt A</button>
    <button data-testid="feature-alt-b" onClick={() => onUpdateAltAndCaption("Alt B", "")}>Alt B</button>
    <span data-testid="cover-id">{featureImage?.id || "no-cover"}</span>
  </div>,
}));
vi.mock("../editor/UnsplashModal", () => ({ UnsplashModal: () => null }));
vi.mock("../MediaPicker", () => ({
  MediaPicker: ({ onSelectAsset }: { onSelectAsset: (asset: Record<string, unknown>) => void }) =>
    <button data-testid="select-feature" onClick={() => onSelectAsset({
      id: "feature-B", url: "/media/feature-B.jpg", displayName: "New cover",
    })}>Select media</button>,
}));
vi.mock("../../lib/api/collaboration", () => ({ transitionPostWorkflow: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const initial = {
  id: "post-1", title: "Initial", slug: "initial", excerpt: "",
  metaTitle: "", metaDescription: "", canonicalUrl: "", status: "draft",
  featured: false, scheduledAt: null, version: 1,
  content: createDefaultStudioDocument("Initial"), contentJson: null, tags: [],
};

describe("PostEditor network-acknowledgement integrity", () => {
  let element: HTMLDivElement;
  let root: Root;
  let saves: Array<{
    body: { content: unknown; excerpt: string | null; tagIds: string[]; expectedVersion: number };
    pending: ReturnType<typeof deferred<{ post: typeof initial }>>;
  }>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    saves = [];
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-1" && options?.method === "PUT") {
        const pending = deferred<{ post: typeof initial }>();
        const body = JSON.parse(String(options.body)) as (typeof saves)[number]["body"];
        saves.push({ body, pending });
        return pending.promise;
      }
      if (url === "/posts/post-1") return Promise.resolve({ post: initial });
      if (url === "/posts/post-1/revisions") return Promise.resolve({ revisions: [] });
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PostEditor postId="post-1" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    element.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function click(testid: string) {
    const button = element.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
    expect(button).not.toBeNull();
    await act(async () => { button?.click(); });
  }

  it("scenario A: an old HTTP response never marks a newer draft saved; B is persisted", async () => {
    await click("edit-a");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(1);
    expect(JSON.stringify(saves[0]?.body.content)).toContain("Draft A");

    await click("edit-b");
    await act(async () => {
      saves[0]!.pending.resolve({ post: { ...initial, version: 2 } });
      await Promise.resolve();
    });
    expect(element.textContent).not.toContain("Draft - Saved");

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(2);
    expect(JSON.stringify(saves[1]?.body.content)).toContain("Draft B");
    expect(saves[1]?.body.expectedVersion).toBe(2);

    await act(async () => {
      saves[1]!.pending.resolve({ post: { ...initial, version: 3 } });
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Draft - Saved");
  });

  it("scenario D: HTTP 409 preserves the author's draft and prevents automatic conflict retries", async () => {
    await click("edit-a");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(1);
    await act(async () => {
      saves[0]!.pending.reject(new ApiError("CONTENT_CONFLICT", "Version conflict", 409));
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Version conflict");
    await click("edit-b");
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(saves).toHaveLength(1);
    expect(element.textContent).toContain("Version conflict");
  });

  it("scenario B: out-of-order network responses cannot regress revision or acknowledge older edits", async () => {
    await click("edit-a");
    await act(async () => { vi.advanceTimersByTime(2000); });
    await click("edit-b");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(2);
    await act(async () => {
      saves[1]!.pending.resolve({ post: { ...initial, version: 3 } });
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Draft - Saved");
    await act(async () => {
      saves[0]!.pending.resolve({ post: { ...initial, version: 2 } });
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Draft - Saved");
  });

  it("blocks default collaborative restoration before confirmation or server mutation", async () => {
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("edit-a");
    await click("restore-revision");
    expect(confirmation).not.toHaveBeenCalled();
    expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url.includes("/restore"))).toBe(false);
    expect(element.textContent).toContain("Revision restoration is unavailable while collaboration is enabled");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(1);
    expect(saves[0]?.body.expectedVersion).toBe(1);
    expect(JSON.stringify(saves[0]?.body.content)).toContain("Draft A");
  });

  it("does not let a live mode-prop change bypass the collaborative restore gate", async () => {
    await act(async () => { root.render(<PostEditor postId="post-1" currentUserId="author" canPublish={false} enableCollaboration={false} onNavigate={vi.fn()} />); });
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("restore-revision");
    expect(confirmation).not.toHaveBeenCalled();
    expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url.includes("/restore"))).toBe(false);
  });

  it("keeps edits made while an authorized revision restore is in flight", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    await act(async () => { root.render(<PostEditor postId="post-1" currentUserId="author" canPublish={false} enableCollaboration={false} onNavigate={vi.fn()} />); });
    const restoration = deferred<{ post: typeof initial }>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const previous = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-1/revisions/revision-1/restore") return restoration.promise;
      return previous(url, options);
    });
    await click("restore-revision");
    await click("edit-b");
    await act(async () => { vi.advanceTimersByTime(2200); });
    expect(saves).toHaveLength(0);
    await act(async () => { restoration.resolve({ post: { ...initial, title: "Restored title", version: 6 } }); });
    expect(element.querySelector<HTMLTextAreaElement>('textarea[aria-label="Post Title"]')?.value).toBe("Initial");
    expect(element.textContent).toContain("newer draft has been kept");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(1);
    expect(saves[0]?.body.expectedVersion).toBe(6);
    expect(JSON.stringify(saves[0]?.body.content)).toContain("Draft B");
  });

  it("does not let an old post response change the active post revision", async () => {
    await click("edit-a");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(1);
    const post2 = { ...initial, id: "post-2", title: "Second", version: 3 };
    const secondSaves: Array<{ expectedVersion: number; content: unknown }> = [];
    const previous = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-2" && options?.method === "PUT") {
        secondSaves.push(JSON.parse(String(options.body)));
        return Promise.resolve({ post: { ...post2, version: 4 } });
      }
      if (url === "/posts/post-2") return Promise.resolve({ post: post2 });
      return previous(url, options);
    });
    await act(async () => { root.render(<PostEditor postId="post-2" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await click("edit-b");
    await act(async () => { saves[0]!.pending.resolve({ post: { ...initial, version: 9 } }); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(secondSaves).toHaveLength(1);
    expect(secondSaves[0]?.expectedVersion).toBe(3);
    expect(JSON.stringify(secondSaves[0]?.content)).toContain("Draft B");
  });

  it("ignores an obsolete document load after a newer post has loaded", async () => {
    const oldLoad = deferred<{ post: typeof initial }>();
    const previous = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-2") return oldLoad.promise;
      if (url === "/posts/post-3") return Promise.resolve({ post: { ...initial, id: "post-3", title: "Newest post", version: 3 } });
      return previous(url, options);
    });
    await act(async () => { root.render(<PostEditor postId="post-2" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await act(async () => { root.render(<PostEditor postId="post-3" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await act(async () => { oldLoad.resolve({ post: { ...initial, id: "post-2", title: "Obsolete post" } }); });
    expect(element.querySelector<HTMLTextAreaElement>('textarea[aria-label="Post Title"]')?.value).toBe("Newest post");
  });

  it("scenario F: sidebar metadata-only changes schedule an immutable snapshot", async () => {
    await click("change-excerpt");
    await click("change-tags");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saves).toHaveLength(1);
    expect(saves[0]?.body.excerpt).toBe("New excerpt");
    expect(saves[0]?.body.tagIds).toEqual(["tag-1"]);
  });

  it("scenario G: navigating away while an edit is pending requires confirmation", async () => {
    await click("edit-b");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const back = Array.from(element.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "Back to Posts");
    expect(back).not.toBeUndefined();
    await act(async () => { back?.click(); });
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("first-create race: saves draft B to newly created post before navigating", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    const create = deferred<{ post: typeof initial }>();
    const updates: Array<{
      body: { content: unknown; expectedVersion: number };
      pending: ReturnType<typeof deferred<{ post: typeof initial }>>;
    }> = [];
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts" && options?.method === "POST") return create.promise;
      if (url === "/posts/post-created" && options?.method === "PUT") {
        const pending = deferred<{ post: typeof initial }>();
        updates.push({ body: JSON.parse(String(options.body)), pending });
        return pending.promise;
      }
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PostEditor currentUserId="author" canPublish={false} onNavigate={navigate} />);
      await Promise.resolve();
    });
    await click("edit-a");
    const button = Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Save Draft");
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
    await click("edit-b");
    await act(async () => {
      create.resolve({ post: { ...initial, id: "post-created", version: 1 } });
      await Promise.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(element.textContent).toContain("newer edits are not yet saved");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0]?.body.content)).toContain("Draft B");
    expect(updates[0]?.body.expectedVersion).toBe(1);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      updates[0]!.pending.resolve({ post: { ...initial, id: "post-created", version: 2 } });
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith("/admin/posts/post-created");
  });

  it("first-create feature image race: PATCHes the new cover before navigating", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    const created = deferred<{ post: typeof initial }>();
    const updated = deferred<{ post: typeof initial }>();
    const featureSaved = deferred<Record<string, unknown>>();
    const navigate = vi.fn();
    let patchBody: Record<string, unknown> | null = null;
    let postCalls = 0;
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts" && options?.method === "POST") {
        postCalls++;
        return created.promise;
      }
      if (url === "/posts/new-post" && options?.method === "PUT") return updated.promise;
      if (url === "/posts/new-post/feature-image" && options?.method === "PATCH") {
        patchBody = JSON.parse(String(options.body)) as Record<string, unknown>;
        return featureSaved.promise;
      }
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PostEditor currentUserId="author" canPublish={false} onNavigate={navigate} />);
      await Promise.resolve();
    });
    await click("edit-a");
    const save = Array.from(element.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Save Draft");
    await act(async () => { save?.click(); });
    await click("open-feature-picker");
    await click("select-feature");
    await act(async () => {
      created.resolve({ post: { ...initial, id: "new-post", version: 1 } });
      await Promise.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      updated.resolve({ post: { ...initial, id: "new-post", version: 2 } });
      await Promise.resolve();
    });
    expect(patchBody).toMatchObject({ featureImageId: "feature-B", featureImageAlt: "New cover" });
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      featureSaved.resolve({ post: { ...initial, id: "new-post", version: 2 } });
      await Promise.resolve();
    });
    expect(postCalls).toBe(1);
    expect(navigate).toHaveBeenCalledWith("/admin/posts/new-post");
  });

  it("first-create retry: failed post-create update never duplicates the created post", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    const created = deferred<{ post: typeof initial }>();
    let postCalls = 0;
    let updateCalls = 0;
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts" && options?.method === "POST") {
        postCalls += 1;
        return created.promise;
      }
      if (url === "/posts/post-created" && options?.method === "PUT") {
        updateCalls += 1;
        if (updateCalls === 1) return Promise.reject(new Error("Offline"));
        return Promise.resolve({ post: { ...initial, id: "post-created", version: 2 } });
      }
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PostEditor currentUserId="author" canPublish={false} onNavigate={navigate} />);
      await Promise.resolve();
    });
    await click("edit-a");
    const save = () => Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Save Draft");
    await act(async () => { save()?.click(); });
    await click("edit-b");
    await act(async () => {
      created.resolve({ post: { ...initial, id: "post-created", version: 1 } });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(updateCalls).toBe(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Offline");
    await act(async () => { save()?.click(); await Promise.resolve(); });
    expect(postCalls).toBe(1);
    expect(updateCalls).toBe(2);
    expect(navigate).toHaveBeenCalledWith("/admin/posts/post-created");
  });


  it("serializes feature-image PATCH requests so a late response cannot restore an old cover", async () => {
    const first = deferred<{ post: typeof initial }>();
    const second = deferred<{ post: typeof initial }>();
    const payloads: Array<{ featureImageId: string | null; featureImageAlt: string }> = [];
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-1/feature-image" && options?.method === "PATCH") {
        payloads.push(JSON.parse(String(options.body)));
        return payloads.length === 1 ? first.promise : second.promise;
      }
      if (url === "/posts/post-1") return Promise.resolve({ post: initial });
      if (url === "/posts/post-1/revisions") return Promise.resolve({ revisions: [] });
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await click("feature-alt-a");
    await click("feature-alt-b");
    // B cannot hit the server before A settles: otherwise a delayed A might
    // persist over B even if its React response is ignored.
    expect(payloads).toEqual([{ featureImageId: null, featureImageAlt: "Alt A" }]);
    await act(async () => {
      first.resolve({ post: Object.assign({}, initial, { featureImage: { id: "old-cover" } }) });
      await Promise.resolve();
    });
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({ featureImageAlt: "Alt B" });
    expect(element.querySelector('[data-testid="cover-id"]')?.textContent).toBe("no-cover");
    await act(async () => {
      second.resolve({ post: Object.assign({}, initial, { featureImage: { id: "new-cover" } }) });
      await Promise.resolve();
    });
    expect(element.querySelector('[data-testid="cover-id"]')?.textContent).toBe("new-cover");
    expect(element.textContent).not.toContain("Feature image was not saved");
  });

  it("shows a failed cover PATCH, protects navigation, and retries the latest snapshot", async () => {
    const pending = deferred<{ post: typeof initial }>();
    const patchPayloads: Array<{ featureImageAlt: string }> = [];
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-1/feature-image" && options?.method === "PATCH") {
        patchPayloads.push(JSON.parse(String(options.body)));
        return patchPayloads.length === 1
          ? pending.promise
          : Promise.resolve({ post: { ...initial, featureImage: null } });
      }
      if (url === "/posts/post-1") return Promise.resolve({ post: initial });
      if (url === "/posts/post-1/revisions") return Promise.resolve({ revisions: [] });
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await click("feature-alt-b");
    expect(element.textContent).toContain("Saving feature image");
    await act(async () => {
      pending.reject(new Error("Offline"));
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Feature image was not saved");
    expect(element.textContent).toContain("Offline");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const back = Array.from(element.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Back"),
    );
    if (back) {
      await act(async () => { back.click(); });
      expect(confirm).toHaveBeenCalled();
    }
    await click("retry-feature-image-save");
    expect(patchPayloads).toHaveLength(2);
    expect(patchPayloads[1]).toMatchObject({ featureImageAlt: "Alt B" });
    expect(element.textContent).not.toContain("Feature image was not saved");
  });

});
