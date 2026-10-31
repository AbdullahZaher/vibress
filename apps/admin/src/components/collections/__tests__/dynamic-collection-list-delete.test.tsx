/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamicCollectionList } from "../DynamicCollectionList";
import { apiRequest } from "../../../lib/api";
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (value: string) => value, locale: "en" }),
}));
vi.mock("../../../lib/api", () => ({
  apiRequest: vi.fn(async (url: string) =>
    url.includes("/entries?") ? { entries: [{ id: "entry-1", title: "Example article", slug: "example", status: "draft", createdAt: "2026-10-01", updatedAt: "2026-10-01" }] } : { model: { name: "Articles" } }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe("Collection entry deletion", () => {
  let element: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    vi.clearAllMocks();
  });
  afterEach(() => {
    act(() => root.unmount());
    element.remove();
  });
  it("asks for named confirmation before executing delete", async () => {
    await act(async () => root.render(<DynamicCollectionList modelSlug="articles" onNavigate={vi.fn()} canEdit />));
    const trigger = element.querySelector<HTMLButtonElement>('[aria-label="Delete Entry: Example article"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Example article");
    expect(vi.mocked(apiRequest).mock.calls.some(([url]) => String(url).endsWith("/entries/entry-1"))).toBe(false);
    await act(async () => {
      Array.from(dialog?.querySelectorAll("button") ?? []).find(b => b.textContent?.trim() === "Delete")?.click();
    });
    expect(vi.mocked(apiRequest).mock.calls.some(([url]) => String(url).endsWith("/entries/entry-1"))).toBe(true);
  });
});
