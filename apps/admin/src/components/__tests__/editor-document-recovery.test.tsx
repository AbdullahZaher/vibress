/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostEditor } from "../PostEditor";
import { PageEditor } from "../PageEditor";
import { apiRequest } from "../../lib/api";

vi.mock("../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (text: string) => text }),
}));
vi.mock("../../lib/api", () => ({
  apiRequest: vi.fn(),
  uploadMediaApi: vi.fn(),
  fetchAiStatus: vi.fn(async () => ({ enabled: false })),
  generateAiCompletion: vi.fn(),
  ApiError: class ApiError extends Error {},
}));
vi.mock("@vibress/studio-react", () => ({
  VibressStudio: ({ value }: { value: unknown }) => <div data-testid="live-lexical-editor" data-document={JSON.stringify(value)}>Editable content</div>,
  WebSocketCollaborationProvider: class {},
  YDoc: class {},
}));
vi.mock("../editor/PostSettingsSidebar", () => ({ PostSettingsSidebar: () => null }));
vi.mock("../editor/PageSettingsSidebar", () => ({ PageSettingsSidebar: () => null }));
vi.mock("../editor/EditorialCollaborationPanel", () => ({ EditorialCollaborationPanel: () => null }));
vi.mock("../editor/RevisionDiffModal", () => ({ RevisionDiffModal: () => null }));
vi.mock("../editor/PostFeatureImageControl", () => ({ PostFeatureImageControl: () => null }));
vi.mock("../editor/UnsplashModal", () => ({ UnsplashModal: () => null }));
vi.mock("../MediaPicker", () => ({ MediaPicker: () => null }));
vi.mock("../../lib/api/collaboration", () => ({ transitionPostWorkflow: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("host rejects persisted documents that would otherwise become empty editable drafts", () => {
  let element: HTMLDivElement;
  let root: Root;
  const unsupported = {
    schema: "vibress-studio",
    version: 2,
    root: { type: "root", children: [
      { type: "future-rich-card", cardData: { text: "Author data cannot be lost" } },
    ] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    element.remove();
  });

  it.each([unsupported, { schema: "vibress-studio", version: 1,
    root: { type: "paragraph", children: [{ type: "text", text: "Retain invalid root content" }] } }])("PostEditor preserves recovery for unsupported or malformed content %#", async (content) => {
    vi.mocked(apiRequest).mockImplementation((url) => {
      if (url === "/posts/post-1") return Promise.resolve({ post: {
        id: "post-1", title: "Stored original", status: "draft",
        slug: "stored", version: 7, content, contentJson: null, tags: [],
      } });
      if (url === "/tags") return Promise.resolve({ tags: [] });
      if (url === "/posts/post-1/revisions") return Promise.resolve({ revisions: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PostEditor postId="post-1" currentUserId="staff" canPublish={false} onNavigate={vi.fn()} />);
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Document recovery required");
    expect(element.textContent).toContain("Saving a replacement is disabled");
    expect(element.querySelector('[data-testid="live-lexical-editor"]')).toBeNull();
    expect(Array.from(element.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("Save Draft"))).toBe(false);
    expect(Array.from(element.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("Export original document"))).toBe(true);
    expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) =>
      path === "/posts/post-1" && init?.method === "PUT")).toBe(false);
  });

  it.each([unsupported, { schema: "vibress-studio", version: 1,
    root: { type: "paragraph", children: [{ type: "text", text: "Retain invalid root content" }] } }])("PageEditor preserves recovery for unsupported or malformed content %#", async (content) => {
    vi.mocked(apiRequest).mockImplementation((url) => {
      if (url === "/pages/page-1") return Promise.resolve({ page: {
        id: "page-1", title: "Stored original", status: "draft",
        slug: "page", version: 6, content,
      } });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PageEditor pageId="page-1" currentUserId="staff" canPublish={false} onNavigate={vi.fn()} />);
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Document recovery required");
    expect(element.querySelector('[data-testid="live-lexical-editor"]')).toBeNull();
    expect(Array.from(element.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("Update Page"))).toBe(false);
    expect(vi.mocked(apiRequest).mock.calls.some(([path, init]) =>
      path === "/pages/page-1" && init?.method === "PUT")).toBe(false);
  });

  it.each(["post", "page"])("opens historical empty %s roots through the canonical editor contract", async (kind) => {
    vi.mocked(apiRequest).mockImplementation((url) => {
      const record = { id: `${kind}-1`, title: "Historical blank", status: "draft", slug: "historical", version: 1,
        content: { version: 1, root: {} }, tags: [] };
      if (url === `/${kind}s/${kind}-1`) return Promise.resolve({ [kind]: record });
      if (url === "/tags") return Promise.resolve({ tags: [] });
      if (url.endsWith("/revisions")) return Promise.resolve({ revisions: [] });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(kind === "post"
        ? <PostEditor postId="post-1" currentUserId="staff" canPublish={false} onNavigate={vi.fn()} />
        : <PageEditor pageId="page-1" currentUserId="staff" canPublish={false} onNavigate={vi.fn()} />);
      await Promise.resolve();
    });
    const editor = element.querySelector('[data-testid="live-lexical-editor"]');
    expect(editor).not.toBeNull();
    expect(JSON.parse(editor?.getAttribute("data-document") || "null")).toMatchObject({
      schema: "vibress-studio", version: 1, root: { type: "root", children: [] },
    });
    expect(element.textContent).not.toContain("INVALID_STUDIO_DOCUMENT");
  });
});
