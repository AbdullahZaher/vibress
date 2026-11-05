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
vi.mock("../editor/PostFeatureImageControl", () => ({ PostFeatureImageControl: () => null }));
vi.mock("../editor/UnsplashModal", () => ({ UnsplashModal: () => null }));
vi.mock("../MediaPicker", () => ({ MediaPicker: () => null }));
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
});
