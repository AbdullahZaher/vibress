/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostsList } from "../PostsList";
import { PagesList } from "../PagesList";
import { apiRequest } from "../../lib/api";

const tr = (value: string) => value;
const formatDate = (d: string) => d;
const formatNumber = (n: number) => String(n);

vi.mock("../../lib/admin-locale", () => ({
  useAdminLocale: () => ({
    tr,
    locale: "en",
    direction: "ltr",
    formatDate,
    formatNumber,
  }),
}));

vi.mock("../../lib/api", () => ({
  apiRequest: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Editorial Selection System — Posts and Pages lifecycle", () => {
  let element: HTMLDivElement;
  let root: Root;

  const mockPosts = [
    {
      id: "post-1",
      title: "First Post",
      slug: "first-post",
      status: "published",
      publishedAt: "2026-10-30T10:00:00Z",
      scheduledAt: null,
      updatedAt: "2026-10-30T10:00:00Z",
      authors: [{ name: "Alice", email: "alice@example.com" }],
    },
    {
      id: "post-2",
      title: "Second Post",
      slug: "second-post",
      status: "draft",
      publishedAt: null,
      scheduledAt: null,
      updatedAt: "2026-10-29T10:00:00Z",
      authors: [{ name: "Bob", email: "bob@example.com" }],
    },
  ];

  const mockPages = [
    {
      id: "page-1",
      title: "About Us",
      slug: "about-us",
      status: "published",
      publishedAt: "2026-10-30T10:00:00Z",
      updatedAt: "2026-10-30T10:00:00Z",
    },
    {
      id: "page-2",
      title: "Contact",
      slug: "contact",
      status: "draft",
      publishedAt: null,
      updatedAt: "2026-10-29T10:00:00Z",
    },
  ];

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

  describe("PostsList selection lifecycle", () => {
    it("starts with selection mode OFF, toggles to Done, selects items, and exits cleanly", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit canCreate />);
      });

      // Selection mode OFF by default
      expect(element.querySelector('input[type="checkbox"]')).toBeNull();
      const selectButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      expect(selectButton).not.toBeUndefined();
      expect(selectButton?.getAttribute("aria-pressed")).toBe("false");

      // Enter selection mode -> button becomes "Done" with aria-pressed="true"
      await act(async () => {
        selectButton?.click();
      });

      const doneButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Done")
      );
      expect(doneButton).not.toBeUndefined();
      expect(doneButton?.getAttribute("aria-pressed")).toBe("true");

      // Checkboxes are now rendered
      const checkboxes = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      // 1 for "Select all on this page" + 2 for rows = 3
      expect(checkboxes.length).toBe(3);

      // Bulk actions not visible yet (0 selected)
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();

      // Click row to toggle selection
      const firstRow = element.querySelectorAll('[role="listitem"]')[0];
      await act(async () => {
        firstRow?.querySelector("h3")?.click();
      });

      // Now 1 post selected: bulk actions group appears
      const bulkGroup = element.querySelector('[role="group"][aria-label="Bulk actions"]');
      expect(bulkGroup).not.toBeNull();
      expect(bulkGroup?.textContent).toContain("1 selected on this page");

      // Exit selection mode via Done
      await act(async () => {
        doneButton?.click();
      });

      // Selection mode OFF: checkboxes and bulk actions removed, button reverts to "Select"
      expect(element.querySelector('input[type="checkbox"]')).toBeNull();
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();
      expect(
        Array.from(element.querySelectorAll("button")).find((b) =>
          b.textContent?.trim().includes("Select")
        )
      ).not.toBeUndefined();
    });

    it("clears selections and announces polite live region notice when filters change, keeping selection mode active", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Enter selection mode
      const selectButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      await act(async () => {
        selectButton?.click();
      });

      // Select first post
      const firstRow = element.querySelectorAll('[role="listitem"]')[0];
      await act(async () => {
        firstRow?.querySelector("h3")?.click();
      });
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).not.toBeNull();

      // Trigger filter change
      const filterButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Filter"
      );
      await act(async () => {
        filterButton?.click();
      });
      const draftOption = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(
        (item) => item.textContent?.includes("Drafts")
      ) as HTMLButtonElement | undefined;
      await act(async () => {
        draftOption?.click();
      });

      // Selection mode stays active (Done button remains)
      expect(
        Array.from(element.querySelectorAll("button")).find((b) =>
          b.textContent?.trim().includes("Done")
        )
      ).not.toBeUndefined();

      // But selectedIds is cleared (Bulk actions gone)
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();

      // Polite live region announces cleared notice
      const politeRegion = element.querySelector('[aria-live="polite"]');
      expect(politeRegion?.textContent).toContain("Selection cleared for new view");
    });
  });

  describe("PagesList selection lifecycle", () => {
    it("starts with selection mode OFF, toggles to Done, selects items, and exits cleanly", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ pages: mockPages, total: 2 });

      await act(async () => {
        root.render(<PagesList onNavigate={vi.fn()} canPublish canDelete canEdit canCreate />);
      });

      // Selection mode OFF by default
      expect(element.querySelector('input[type="checkbox"]')).toBeNull();
      const selectButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      expect(selectButton).not.toBeUndefined();
      expect(selectButton?.getAttribute("aria-pressed")).toBe("false");

      // Enter selection mode -> button becomes "Done"
      await act(async () => {
        selectButton?.click();
      });

      const doneButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Done")
      );
      expect(doneButton).not.toBeUndefined();
      expect(doneButton?.getAttribute("aria-pressed")).toBe("true");

      // Select all checkbox
      const selectAllCb = element.querySelector<HTMLInputElement>('input[aria-label="Select all on this page"]');
      expect(selectAllCb).not.toBeNull();
      await act(async () => {
        selectAllCb?.click();
      });

      // Bulk actions appear with 2 selected
      const bulkGroup = element.querySelector('[role="group"][aria-label="Bulk actions"]');
      expect(bulkGroup).not.toBeNull();
      expect(bulkGroup?.textContent).toContain("2 selected on this page");

      // Done exits selection mode
      await act(async () => {
        doneButton?.click();
      });
      expect(element.querySelector('input[type="checkbox"]')).toBeNull();
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();
    });
  });
});
