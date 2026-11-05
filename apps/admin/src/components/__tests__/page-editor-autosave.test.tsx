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
});
