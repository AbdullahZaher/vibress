/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteIdentityCard } from "../SiteIdentityCard";
import { uploadMediaApi } from "../../../../lib/api/media";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../../lib/api/media", () => ({ uploadMediaApi: vi.fn() }));

describe("Site Identity", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
  });
  afterEach(() => {
    act(() => root.unmount());
    node.remove();
    vi.resetAllMocks();
  });

  it("keeps the original deep link and no longer exposes a global palette", async () => {
    await act(async () => {
      root.render(<SiteIdentityCard iconUrl="/icon.png" logoUrl="/logo.png" />);
    });
    expect(node.querySelector("#site-branding")).not.toBeNull();
    expect(node.textContent).toContain("Site Identity");
    await act(async () => {
      node.querySelector<HTMLButtonElement>('button[aria-controls]')?.click();
    });
    expect(node.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(node.querySelector('input[type="color"]')).toBeNull();
    expect(node.textContent).not.toContain("Live Brand Style & Palette");
    expect(node.textContent).not.toContain("Publication accent color");
    expect(node.querySelector('img[alt="Publication Icon"]')).not.toBeNull();
    expect(node.querySelector('img[alt="Publication Logo"]')).not.toBeNull();
  });

  it("keeps icon and logo uploads publication-owned and editable through the save bar", async () => {
    const onChange = vi.fn();
    vi.mocked(uploadMediaApi)
      .mockResolvedValueOnce({ media: { url: "/new-icon.png" } } as Awaited<ReturnType<typeof uploadMediaApi>>)
      .mockResolvedValueOnce({ media: { url: "/new-logo.png" } } as Awaited<ReturnType<typeof uploadMediaApi>>);
    await act(async () => {
      root.render(<SiteIdentityCard onChange={onChange} />);
    });
    await act(async () => {
      node.querySelector<HTMLButtonElement>('button[aria-controls]')?.click();
    });
    const files = node.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(files).toHaveLength(2);
    for (const [index, filename] of [[0, "icon.png"], [1, "logo.png"]] as const) {
      const input = files[index];
      expect(input).toBeDefined();
      if (!input) continue;
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["image"], filename, { type: "image/png" })],
      });
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    }
    expect(onChange).toHaveBeenCalledWith("iconUrl", "/new-icon.png");
    expect(onChange).toHaveBeenCalledWith("logoUrl", "/new-logo.png");
  });
});
