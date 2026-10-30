/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { AdminPageHeader } from "../AdminPageHeader";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AdminPageHeader component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders standardized title and muted description without leading icons", async () => {
    await act(async () => {
      root.render(
        <AdminPageHeader
          title="Posts"
          description="Manage your published posts and drafts"
          titleId="page-title-posts"
        />
      );
    });

    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.textContent?.trim()).toBe("Posts");
    expect(h1?.id).toBe("page-title-posts");
    expect(h1?.className).toContain("text-xl sm:text-2xl font-bold tracking-tight text-foreground");
    // Assert no svg icon inside h1 or as a sibling leading icon in title block
    expect(h1?.querySelector("svg")).toBeNull();

    const desc = container.querySelector("p");
    expect(desc).not.toBeNull();
    expect(desc?.textContent?.trim()).toBe("Manage your published posts and drafts");
    expect(desc?.className).toContain("text-sm leading-relaxed text-muted-foreground mt-1");
  });

  it("renders page action buttons on desktop/mobile", async () => {
    await act(async () => {
      root.render(
        <AdminPageHeader
          title="Members"
          description="Manage site subscribers and accounts"
          actions={<button type="button" id="create-member-btn">New Member</button>}
        />
      );
    });

    const actionBtn = container.querySelector("#create-member-btn");
    expect(actionBtn).not.toBeNull();
    expect(actionBtn?.textContent).toBe("New Member");
  });

  it("renders breadcrumb and backAction when provided", async () => {
    await act(async () => {
      root.render(
        <AdminPageHeader
          title="Custom Fields"
          description="Edit schema attributes"
          breadcrumb={<span>Settings / Schema</span>}
          backAction={<button type="button" aria-label="Go Back">Back</button>}
        />
      );
    });

    expect(container.textContent).toContain("Settings / Schema");
    const backBtn = container.querySelector('button[aria-label="Go Back"]');
    expect(backBtn).not.toBeNull();
  });
});
