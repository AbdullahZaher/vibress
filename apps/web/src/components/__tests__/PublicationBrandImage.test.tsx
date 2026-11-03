/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublicationBrandImage, safePublicationImageUrl } from "../PublicationBrandImage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("publication identity asset fallback", () => {
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
  });

  it("accepts safe public media URLs and rejects unsafe or malformed URLs", () => {
    expect(safePublicationImageUrl("/media/uploads/logo.svg")).toBe("/media/uploads/logo.svg");
    expect(safePublicationImageUrl("https://cdn.example.test/logo.png")).toBe("https://cdn.example.test/logo.png");
    for (const candidate of ["javascript:alert(1)", "//evil.test/logo.png", "data:image/svg+xml,code", "/\\evil.test", "http://"]) {
      expect(safePublicationImageUrl(candidate)).toBeNull();
    }
  });

  it("uses the configured publication logo with Arabic accessible text", () => {
    act(() => root.render(
      <div dir="rtl"><PublicationBrandImage url="/media/logo-ar.png" title="مجلة التصميم" /></div>,
    ));
    expect(node.querySelector("div")?.getAttribute("dir")).toBe("rtl");
    expect(node.querySelector("img")?.getAttribute("src")).toBe("/media/logo-ar.png");
    expect(node.querySelector("img")?.getAttribute("alt")).toBe("مجلة التصميم");
  });

  it("renders publication title if absent or if image loading fails", () => {
    act(() => root.render(<PublicationBrandImage title="مجلة التصميم" />));
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toContain("مجلة التصميم");

    act(() => root.render(<PublicationBrandImage url="/missing-logo.png" title="مجلة التصميم" />));
    const image = node.querySelector("img");
    expect(image).not.toBeNull();
    act(() => image?.dispatchEvent(new Event("error")));
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toContain("مجلة التصميم");
  });

  it("avoids redundant screen-reader labels when the header displays the title separately", () => {
    act(() => root.render(
      <PublicationBrandImage url="/icon.png" title="Vibress" showFallbackText={false} />,
    ));
    expect(node.querySelector("img")?.getAttribute("alt")).toBe("");
    act(() => node.querySelector("img")?.dispatchEvent(new Event("error")));
    expect(node.textContent).toBe("");
  });
});
