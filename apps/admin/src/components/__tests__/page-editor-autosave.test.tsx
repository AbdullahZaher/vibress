/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStudioDocument } from "@vibress/studio-core";
import { PageEditor } from "../PageEditor";
import { apiRequest } from "../../lib/api";

vi.mock("../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (label: string) => label }),
}));
vi.mock("../../lib/api", () => ({
  apiRequest: vi.fn(),
  uploadMediaApi: vi.fn(),
  fetchAiStatus: vi.fn(async () => ({ enabled: false })),
  generateAiCompletion: vi.fn(),
}));
vi.mock("@vibress/studio-react", () => ({
  VibressStudio: ({ onChange }: { onChange: (doc: unknown) => void }) => (
    <div>
      <button data-testid="page-a" onClick={() => onChange(createDefaultStudioDocument("Page A"))}>
        Edit A
      </button>
      <button data-testid="page-b" onClick={() => onChange(createDefaultStudioDocument("Page B"))}>
        Edit B
      </button>
    </div>
  ),
}));
vi.mock("../editor/PageSettingsSidebar", () => ({
  PageSettingsSidebar: ({ setExcerpt }: { setExcerpt: (value: string) => void }) => (
    <button data-testid="page-excerpt" onClick={() => setExcerpt("New page excerpt")}>Excerpt</button>
  ),
}));
vi.mock("../MediaPicker", () => ({ MediaPicker: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function deferred<T>() {
  let resolve!: (data: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const initial = {
  id: "page-1", title: "Page", slug: "page", excerpt: "",
  metaTitle: "", metaDescription: "", canonicalUrl: "", status: "draft",
  version: 1, content: createDefaultStudioDocument("Initial page"),
};

describe("PageEditor host autosave generations (real component and mocked HTTP)", () => {
  let element: HTMLDivElement;
  let root: Root;
  let requests: Array<{
    payload: { content: unknown; expectedVersion: number; excerpt: string | null };
    response: ReturnType<typeof deferred<{ page: { version: number } }>>;
  }>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    requests = [];
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/pages/page-1" && options?.method === "PUT") {
        const response = deferred<{ page: { version: number } }>();
        requests.push({
          payload: JSON.parse(String(options.body)) as (typeof requests)[number]["payload"],
          response,
        });
        return response.promise;
      }
      if (url === "/pages/page-1") return Promise.resolve({ page: initial });
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PageEditor pageId="page-1" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    element.remove();
    vi.useRealTimers();
  });

  async function edit(testId: string) {
    const button = element.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    expect(button).not.toBeNull();
    await act(async () => { button?.click(); });
  }

  it("does not call page B saved when response for page A finishes first", async () => {
    await edit("page-a");
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]?.payload.content)).toContain("Page A");
    await edit("page-b");
    await act(async () => {
      requests[0]!.response.resolve({ page: { version: 2 } });
      await Promise.resolve();
    });
    expect(element.textContent).not.toContain("Draft - Saved");
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.payload.content)).toContain("Page B");
    expect(requests[1]?.payload.expectedVersion).toBe(2);
    await act(async () => {
      requests[1]!.response.resolve({ page: { version: 3 } });
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Draft - Saved");
  });

  it("ignores an obsolete page load after a newer page is active", async () => {
    const obsolete = deferred<{ page: typeof initial }>();
    const previous = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/pages/page-2") return obsolete.promise;
      if (url === "/pages/page-3") return Promise.resolve({ page: { ...initial, id: "page-3", title: "Newest page", version: 3 } });
      return previous(url, options);
    });
    await act(async () => { root.render(<PageEditor pageId="page-2" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await act(async () => { root.render(<PageEditor pageId="page-3" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await act(async () => { obsolete.resolve({ page: { ...initial, id: "page-2", title: "Obsolete page" } }); });
    expect(element.querySelector<HTMLTextAreaElement>('textarea[aria-label="Page Title"]')?.value).toBe("Newest page");
  });

  it("invalidates a save across A to B to A and keeps the newest revision", async () => {
    await edit("page-a");
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(requests).toHaveLength(1);
    const previous = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/pages/page-2") return Promise.resolve({ page: { ...initial, id: "page-2", title: "Second page", version: 2 } });
      if (url === "/pages/page-1" && !options?.method) return Promise.resolve({ page: { ...initial, version: 3 } });
      return previous(url, options);
    });
    await act(async () => { root.render(<PageEditor pageId="page-2" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await act(async () => { root.render(<PageEditor pageId="page-1" currentUserId="author" canPublish={false} onNavigate={vi.fn()} />); });
    await edit("page-b");
    await act(async () => { requests[0]!.response.resolve({ page: { version: 9 } }); });
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.payload.expectedVersion).toBe(3);
    expect(JSON.stringify(requests[1]?.payload.content)).toContain("Page B");
  });

  it("keeps sidebar metadata-only changes in autosave payload", async () => {
    await edit("page-excerpt");
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.payload.excerpt).toBe("New page excerpt");
  });

  it("does not retry automatically after an HTTP 409 conflict", async () => {
    await edit("page-a");
    await act(async () => { vi.advanceTimersByTime(1200); });
    await act(async () => {
      requests[0]!.response.reject(Object.assign(new Error("Content conflict"),
        { code: "CONTENT_CONFLICT" }));
      await Promise.resolve();
    });
    expect(element.textContent).toContain("Version Conflict Detected");
    await edit("page-b");
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(requests).toHaveLength(1);
  });

  it("first-create race: does not navigate until newer page edits are saved at created revision", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    const creation = deferred<{ page: { id: string; version: number } }>();
    const pending = deferred<{ page: { version: number } }>();
    const updates: Array<{ content: unknown; expectedVersion: number }> = [];
    let creations = 0;
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/pages" && options?.method === "POST") {
        creations++;
        return creation.promise;
      }
      if (url === "/pages/new-page" && options?.method === "PUT") {
        updates.push(JSON.parse(String(options.body)));
        return pending.promise;
      }
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PageEditor currentUserId="author" canPublish={false} onNavigate={navigate} />);
      await Promise.resolve();
    });
    await edit("page-a");
    const create = Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Create Page");
    expect(create).toBeDefined();
    await act(async () => { create?.click(); });
    await edit("page-b");
    await act(async () => {
      creation.resolve({ page: { id: "new-page", version: 1 } });
      await Promise.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0]?.content)).toContain("Page B");
    expect(updates[0]?.expectedVersion).toBe(1);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ page: { version: 2 } });
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith("/admin/pages/new-page");
    expect(creations).toBe(1);
  });

  it("first-create failure: keeps draft and retries via PUT without repeating POST", async () => {
    await act(async () => { root.unmount(); });
    root = createRoot(element);
    const creation = deferred<{ page: { id: string; version: number } }>();
    let creations = 0;
    let updates = 0;
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockImplementation((url, options) => {
      if (url === "/pages" && options?.method === "POST") {
        creations++;
        return creation.promise;
      }
      if (url === "/pages/new-page" && options?.method === "PUT") {
        updates++;
        if (updates === 1) return Promise.reject(new Error("Network offline"));
        return Promise.resolve({ page: { version: 2 } });
      }
      return Promise.resolve({});
    });
    await act(async () => {
      root.render(<PageEditor currentUserId="author" canPublish={false} onNavigate={navigate} />);
      await Promise.resolve();
    });
    await edit("page-a");
    const create = Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Create Page");
    await act(async () => { create?.click(); });
    await edit("page-b");
    await act(async () => {
      creation.resolve({ page: { id: "new-page", version: 1 } });
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(1200); await Promise.resolve(); });
    expect(element.textContent).toContain("Network offline");
    expect(navigate).not.toHaveBeenCalled();
    const retry = Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Save Latest Changes");
    expect(retry).toBeDefined();
    await act(async () => { retry?.click(); await Promise.resolve(); });
    expect(creations).toBe(1);
    expect(updates).toBe(2);
    expect(navigate).toHaveBeenCalledWith("/admin/pages/new-page");
  });

});
