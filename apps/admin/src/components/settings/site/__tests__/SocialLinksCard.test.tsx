/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialLinksCard } from "../SocialLinksCard";
import type { SocialLink } from "@vibress/api-contracts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SocialLinksCard Component", () => {
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

  it("renders safely when links prop is undefined", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <SocialLinksCard
          links={undefined}
          onChange={onChange}
        />
      );
    });

    expect(container.textContent).toContain("Social links");
    expect(container.textContent).toContain("0 links");
  });

  it("renders count when links are provided", () => {
    const mockLinks: SocialLink[] = [
      { id: "1", platform: "github", label: "GitHub", url: "https://github.com/example" },
      { id: "2", platform: "x", label: "X", url: "https://x.com/example" },
    ];
    const onChange = vi.fn();

    act(() => {
      root.render(
        <SocialLinksCard
          links={mockLinks}
          onChange={onChange}
        />
      );
    });

    expect(container.textContent).toContain("2 links");
  });

  it("expands and allows adding a link", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <SocialLinksCard
          links={[]}
          onChange={onChange}
        />
      );
    });

    const manageBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Manage")
    );
    expect(manageBtn).toBeDefined();

    act(() => {
      manageBtn?.click();
    });

    const addBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Add social link")
    );
    expect(addBtn).toBeDefined();

    act(() => {
      addBtn?.click();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const addedLinks = onChange.mock.calls[0]?.[0];
    expect(addedLinks).toHaveLength(1);
    expect(addedLinks[0].platform).toBe("instagram");
  });
});
