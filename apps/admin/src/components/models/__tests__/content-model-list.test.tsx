/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../../lib/api";
import { ContentModelList } from "../ContentModelList";

vi.mock("../../../lib/api", () => ({
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ContentModelList admin design and navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses admin table and keeps read-only access to editorial entries", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [{
        id: "model-1",
        name: "منتجات",
        slug: "products",
        description: "Structured products",
        fields: [{ key: "name", name: "Name", type: "text" }],
        createdAt: "2026-10-01",
      }],
    });
    const onNavigate = vi.fn();
    await act(async () => {
      root.render(<ContentModelList onNavigate={onNavigate} canManage={false} />);
    });

    expect(container.querySelector("h1")?.textContent).toContain("Content Models");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("table")?.textContent).toContain("منتجات");
    expect(container.querySelector('button[aria-label="Delete منتجات"]')).toBeNull();
    expect(container.textContent).not.toContain("Create Model");

    const entries = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Entries"),
    );
    await act(async () => entries?.click());
    expect(onNavigate).toHaveBeenCalledWith("/admin/collections/products");
  });

  it("keeps configuration actions in Advanced settings for authorized staff", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: [{
        id: "model-1",
        name: "Products",
        slug: "products",
        fields: [],
        createdAt: "2026-10-01",
      }],
    });
    const onNavigate = vi.fn();
    await act(async () => {
      root.render(<ContentModelList onNavigate={onNavigate} canManage />);
    });
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Create Model"),
    );
    await act(async () => create?.click());
    expect(onNavigate).toHaveBeenCalledWith("/admin/settings/advanced/content-models/new");

    const edit = container.querySelector('button[aria-label="Edit Products"]');
    await act(async () => (edit as HTMLButtonElement | null)?.click());
    expect(onNavigate).toHaveBeenCalledWith("/admin/settings/advanced/content-models/model-1");
  });

  it("shows retry when the models request fails, not a false empty state", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("Network unavailable"));
    await act(async () => {
      root.render(<ContentModelList onNavigate={vi.fn()} />);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Network unavailable");
    expect(container.textContent).not.toContain("No content models yet");
  });
});
