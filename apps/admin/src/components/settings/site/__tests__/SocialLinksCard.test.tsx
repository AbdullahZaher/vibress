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
    const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders safely and expands to display links when links are provided", () => {
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

    expect(container.textContent).toContain("Social links");
    const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      toggle.click();
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("fieldset")).toHaveLength(2);
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

    const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle).toBeTruthy();

    act(() => {
      toggle.click();
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
