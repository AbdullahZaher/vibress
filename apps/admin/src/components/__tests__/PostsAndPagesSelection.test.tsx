/** @vitest-environment jsdom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostsList } from "../PostsList";
import { PagesList } from "../PagesList";
import { apiRequest } from "../../lib/api";

let currentLocale = "en";
let currentDirection: "ltr" | "rtl" = "ltr";

const formatDate = (d: string) => d;
const formatNumber = (n: number) => String(n);
const tr = (value: string) => {
  if (currentLocale === "ar") {
    if (value === "Select") return "تحديد";
    if (value === "Done") return "تم";
    if (value === "Showing") return "عرض";
    if (value === "posts") return "مقالات";
    if (value === "pages") return "صفحات";
  }
  return value;
};

vi.mock("../../lib/admin-locale", () => ({
  useAdminLocale: () => ({
    tr,
    locale: currentLocale,
    direction: currentDirection,
    formatDate,
    formatNumber,
  }),
}));

vi.mock("../../lib/api", () => ({
  apiRequest: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Editorial Selection System — Posts and Pages lifecycle & stability", () => {
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
    currentLocale = "en";
    currentDirection = "ltr";
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

      // Checkboxes are now rendered (1 Select all + 2 rows = 3)
      const checkboxes = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
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

    it("clears selections and keeps post count visible when filters change, keeping selection mode active", async () => {
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

      // Selected items are cleared (Bulk actions gone)
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();

      // Post count remains visible and unchanged!
      expect(element.textContent).toContain("Showing 2 posts");

      // Polite live region announces cleared notice
      const politeRegion = element.querySelector('[role="status"][aria-live="polite"]');
      expect(politeRegion?.textContent).toContain("Selection cleared for new view");

      // Visual cleared notice is rendered separately alongside the count with aria-hidden="true" to prevent double screen reader announcement
      const visualNotice = element.querySelector('span[aria-hidden="true"]');
      expect(visualNotice?.textContent).toContain("Selection cleared for new view");
    });

    it("preserves selection state across language/theme changes without clearing", async () => {
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

      // Switch language to Arabic RTL
      currentLocale = "ar";
      currentDirection = "rtl";

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Selection mode is still active: button shows Arabic "تم" (Done)
      expect(
        Array.from(element.querySelectorAll("button")).find((b) =>
          b.textContent?.trim().includes("تم")
        )
      ).not.toBeUndefined();

      // Bulk actions group is still rendered with 1 item selected!
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).not.toBeNull();
      const firstCheckbox = element.querySelectorAll<HTMLInputElement>('[role="listitem"] input[type="checkbox"]')[0];
      expect(firstCheckbox?.checked).toBe(true);
    });

    it("survives React Strict Mode with pure state updaters and no double-effect bugs", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(
          <StrictMode>
            <PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />
          </StrictMode>
        );
      });

      const selectButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      expect(selectButton).not.toBeUndefined();

      // Toggle to selection mode
      await act(async () => {
        selectButton?.click();
      });

      const doneButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Done")
      );
      expect(doneButton).not.toBeUndefined();

      // Rapidly toggle Done -> Select -> Done
      await act(async () => {
        doneButton?.click();
      });
      expect(element.querySelector('input[type="checkbox"]')).toBeNull();

      const selectAgain = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      await act(async () => {
        selectAgain?.click();
      });
      expect(element.querySelectorAll('input[type="checkbox"]').length).toBe(3);
    });

    it("cleans up notification timers on unmount without errors", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Enter selection mode and select an item
      const selectButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      await act(async () => {
        selectButton?.click();
      });

      const firstRow = element.querySelectorAll('[role="listitem"]')[0];
      await act(async () => {
        firstRow?.querySelector("h3")?.click();
      });

      // Change filter to trigger notice and timer
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

      // Unmount component
      await act(async () => {
        root.unmount();
      });

      // Timer cleanup was called
      expect(clearTimeoutSpy).toHaveBeenCalled();
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

      // Page count remains visible
      expect(element.textContent).toContain("Showing 2 pages");

      // Done exits selection mode
      await act(async () => {
        doneButton?.click();
      });
      expect(element.querySelector('input[type="checkbox"]')).toBeNull();
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();
    });

    it("maintains selection mode and stable page count when filters change in PagesList", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ pages: mockPages, total: 2 });

      await act(async () => {
        root.render(<PagesList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      const selectButton = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      );
      await act(async () => {
        selectButton?.click();
      });

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

      // Mode stays ON
      expect(
        Array.from(element.querySelectorAll("button")).find((b) =>
          b.textContent?.trim().includes("Done")
        )
      ).not.toBeUndefined();

      // Selected IDs cleared
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();

      // Page count remains visible
      expect(element.textContent).toContain("Showing 2 pages");

      // Live region announcement
      const politeRegion = element.querySelector('[role="status"][aria-live="polite"]');
      expect(politeRegion?.textContent).toContain("Selection cleared for new view");
    });

    it("guards against executing confirmed mutations if view parameters changed", async () => {
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

      // Select post-1
      const firstRow = element.querySelectorAll('[role="listitem"]')[0];
      await act(async () => {
        firstRow?.querySelector("h3")?.click();
      });

      // Click Delete in bulk toolbar to open confirmation dialog
      const bulkGroup = element.querySelector('[role="group"][aria-label="Bulk actions"]');
      expect(bulkGroup).not.toBeNull();
      const bulkDeleteBtn = Array.from(bulkGroup?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.trim().includes("Delete")
      );
      expect(bulkDeleteBtn).not.toBeUndefined();
      await act(async () => {
        bulkDeleteBtn?.click();
      });

      // Dialog is open
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();

      // Now filter changes while dialog is open
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

      // Dialog is automatically dismissed and safe from accidental confirmation
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      // No DELETE API request was fired
      expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith(
        expect.stringContaining("/posts/post-1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("isolates More Actions trigger clicks from row selection toggles", async () => {
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

      // Target row's more actions button
      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      expect(moreActionsBtn).not.toBeNull();

      // Click More Actions
      await act(async () => {
        moreActionsBtn.click();
      });

      // More actions menu should open, but the row should NOT be selected
      const menu = document.querySelector('[role="menu"]');
      expect(menu).not.toBeNull();
      expect(element.querySelector('[role="group"][aria-label="Bulk actions"]')).toBeNull();
    });

    it("immediately invalidates confirmation dialog when typing into search during debounced search", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Open delete dialog via More Actions -> Delete on first row
      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      await act(async () => {
        moreActionsBtn.click();
      });

      const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      expect(deleteItem).not.toBeUndefined();

      await act(async () => {
        deleteItem.click();
      });

      // Dialog is open
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      // User types into search input before the 250ms debounce window completes
      const searchInput = element.querySelector('input[type="search"]') as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      // Trigger change on search input
      await act(async () => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(searchInput, "breaking news");
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));
      });

      // The open confirmation dialog is immediately closed / invalidated
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("restores focus to surviving row after single row deletion", async () => {
      vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/posts/post-1")) {
          return { success: true };
        }
        return { posts: mockPosts, total: 2 };
      });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Open more actions on post-1 and click Delete
      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      await act(async () => {
        moreActionsBtn.click();
      });

      const deleteMenuItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteMenuItem.click();
      });

      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      // Mock the subsequent fetchPosts to return only post-2
      vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/posts/post-1")) {
          return { success: true };
        }
        return { posts: [mockPosts[1]], total: 1 };
      });

      // Confirm delete
      const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent?.includes("Confirm delete")
      ) as HTMLButtonElement;
      expect(confirmBtn).not.toBeUndefined();

      await act(async () => {
        confirmBtn.click();
      });

      // Allow requestAnimationFrame / DOM focus flush
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(r));
      });

      // Focus should be restored to an interactive element within the surviving row, not body
      expect(document.activeElement).not.toBe(document.body);
      const survivingRow = element.querySelector('[role="listitem"]');
      expect(survivingRow?.contains(document.activeElement)).toBe(true);
    });

    it("restores focus to empty-state action when the final item is deleted", async () => {
      vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/posts/post-1")) {
          return { success: true };
        }
        return { posts: [mockPosts[0]], total: 1 };
      });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit canCreate />);
      });

      // Delete the only post
      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      await act(async () => {
        moreActionsBtn.click();
      });

      const deleteMenuItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteMenuItem.click();
      });

      // Subsequent fetch returns 0 posts
      vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/posts/post-1")) {
          return { success: true };
        }
        return { posts: [], total: 0 };
      });

      const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent?.includes("Confirm delete")
      ) as HTMLButtonElement;

      await act(async () => {
        confirmBtn.click();
      });

      await act(async () => {
        await new Promise((r) => requestAnimationFrame(r));
      });

      // Focus should not be on document.body, but on the empty state action button or search
      expect(document.activeElement).not.toBe(document.body);
      expect(
        document.activeElement?.textContent?.includes("New Post") ||
        document.activeElement?.getAttribute("type") === "search" ||
        document.activeElement?.textContent?.includes("Select")
      ).toBe(true);
    });

    it("PagesList: immediately invalidates confirmation dialog when typing into search", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ pages: mockPages, total: 2 });

      await act(async () => {
        root.render(<PagesList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      await act(async () => {
        moreActionsBtn.click();
      });

      const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteItem.click();
      });

      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      const searchInput = element.querySelector('input[type="search"]') as HTMLInputElement;
      await act(async () => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(searchInput, "terms of service");
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("dialog cancellation via Escape, Cancel button, and Close button restores focus to trigger", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit canCreate />);
      });

      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      expect(moreActionsBtn).not.toBeNull();

      // Case 1: Cancel via Escape
      moreActionsBtn.focus();
      await act(async () => {
        moreActionsBtn.click();
      });
      const deleteMenuItem1 = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteMenuItem1.click();
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(moreActionsBtn);

      // Case 2: Cancel via Cancel button
      moreActionsBtn.focus();
      await act(async () => {
        moreActionsBtn.click();
      });
      const deleteMenuItem2 = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteMenuItem2.click();
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      const cancelBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent?.trim() === "Cancel"
      ) as HTMLButtonElement;
      await act(async () => {
        cancelBtn.click();
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(moreActionsBtn);

      // Case 3: Cancel via Close (X) button
      moreActionsBtn.focus();
      await act(async () => {
        moreActionsBtn.click();
      });
      const deleteMenuItem3 = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteMenuItem3.click();
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      const closeBtn = document.querySelector('[role="dialog"] button[aria-label="Close dialog"]') as HTMLButtonElement;
      await act(async () => {
        closeBtn.click();
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(moreActionsBtn);
    });

    it("dialog traps keyboard focus with Tab and Shift+Tab", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      const moreActionsBtn = element.querySelector('button[aria-label*="More actions"]') as HTMLButtonElement;
      await act(async () => {
        moreActionsBtn.click();
      });

      const deleteMenuItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteMenuItem.click();
      });

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();

      const buttons = Array.from(dialog!.querySelectorAll<HTMLButtonElement>("button"));
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      const firstButton = buttons[0]!;
      const lastButton = buttons[buttons.length - 1]!;

      // When active is on the last button, Tab wraps to the first button
      lastButton.focus();
      expect(document.activeElement).toBe(lastButton);

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(firstButton);

      // When active is on the first button, Shift+Tab wraps to the last button
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(lastButton);
    });

    it("restores focus to surviving row after publish and unpublish operations", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Enter selection mode
      const selectBtn = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      ) as HTMLButtonElement;
      await act(async () => {
        selectBtn.click();
      });

      // Select draft post (post-2)
      const checkboxes = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      await act(async () => {
        checkboxes[2]?.click(); // index 0 is select all, 1 is post-1, 2 is post-2
      });

      // Click Publish in bulk actions toolbar
      const publishBtn = Array.from(element.querySelectorAll('[role="group"] button')).find(
        (b) => b.textContent?.includes("Publish")
      ) as HTMLButtonElement;
      await act(async () => {
        publishBtn.click();
      });

      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      // Mock successful publish
      vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/publish")) {
          return { success: true };
        }
        return {
          posts: [
            mockPosts[0],
            { ...mockPosts[1], status: "published" },
          ],
          total: 2,
        };
      });

      const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent?.includes("Confirm publish")
      ) as HTMLButtonElement;

      await act(async () => {
        confirmBtn.click();
      });

      await act(async () => {
        await new Promise((r) => requestAnimationFrame(r));
      });

      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).not.toBe(document.body);
      const survivingRows = element.querySelectorAll('[role="listitem"]');
      const focusedRow = Array.from(survivingRows).find((r) => r.contains(document.activeElement));
      expect(focusedRow).not.toBeUndefined();
    });

    it("restores focus and preserves selection on mutation failure so user can retry", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ posts: mockPosts, total: 2 });

      await act(async () => {
        root.render(<PostsList onNavigate={vi.fn()} canPublish canDelete canEdit />);
      });

      // Enter selection mode
      const selectBtn = Array.from(element.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().includes("Select")
      ) as HTMLButtonElement;
      await act(async () => {
        selectBtn.click();
      });

      // Select post-1
      const checkboxes = element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      await act(async () => {
        checkboxes[1]?.click();
      });

      // Bulk Delete
      const deleteBulkBtn = Array.from(element.querySelectorAll('[role="group"] button')).find(
        (b) => b.textContent?.includes("Delete")
      ) as HTMLButtonElement;
      await act(async () => {
        deleteBulkBtn.click();
      });

      // Mock API rejection (server error)
      vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("/posts/post-1")) {
          throw new Error("Server error: failed to delete");
        }
        return { posts: mockPosts, total: 2 };
      });

      const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent?.includes("Confirm delete")
      ) as HTMLButtonElement;

      await act(async () => {
        confirmBtn.click();
      });

      await act(async () => {
        await new Promise((r) => requestAnimationFrame(r));
      });

      // Dialog is closed
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      // Error message is displayed
      expect(element.textContent).toContain("failed");

      // Failed item selection is preserved for retry
      const bulkGroup = element.querySelector('[role="group"][aria-label="Bulk actions"]');
      expect(bulkGroup).not.toBeNull();
      expect(bulkGroup?.textContent).toContain("1 selected on this page");

      // Focus is not lost to document.body
      expect(document.activeElement).not.toBe(document.body);
    });
  });
});
