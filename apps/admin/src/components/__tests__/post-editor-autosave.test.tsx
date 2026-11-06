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
  PostSettingsSidebar: ({ setExcerpt, setSelectedTagIds }: {
    setExcerpt: (value: string) => void;
    setSelectedTagIds: (ids: string[]) => void;
  }) => <div>
    <button data-testid="change-excerpt" onClick={() => setExcerpt("New excerpt")}>Excerpt edit</button>
    <button data-testid="change-tags" onClick={() => setSelectedTagIds(["tag-1"])}>Tag edit</button>
  </div>,
}));
vi.mock("../editor/EditorialCollaborationPanel", () => ({ EditorialCollaborationPanel: () => null }));
vi.mock("../editor/RevisionDiffModal", () => ({ RevisionDiffModal: () => null }));
vi.mock("../editor/PostFeatureImageControl", () => ({
  PostFeatureImageControl: ({ onOpenMediaPicker }: { onOpenMediaPicker: () => void }) =>
    <button data-testid="open-feature-picker" onClick={onOpenMediaPicker}>Choose feature</button>,
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

  it("distinguishes publication status from acknowledged saving on a published post", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    const published = { ...initial, status: "published" };
    const pending = deferred<{ post: typeof initial }>();
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/posts/post-1" && options?.method === "PUT") return pending.promise;
      if (url === "/posts/post-1") return Promise.resolve({ post: published });
      if (url === "/posts/post-1/revisions") return Promise.resolve({ revisions: [] });
      if (url === "/tags") return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PostEditor postId="post-1" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />);
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Published");
    await click("edit-a");
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
    expect(element.textContent).not.toContain("Published · Saved");
    await act(async () => {
      pending.resolve({ post: { ...published, version: 2 } });
      await pending.promise;
    });
    expect(element.textContent).toContain("Published · Saved");
  });

});
