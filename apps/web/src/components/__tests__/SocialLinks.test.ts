/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SocialLinks } from "../SocialLinks";
import type { SiteSocialLinkViewModel } from "@vibress/theme-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SocialLinks Component", () => {
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

  it("renders null when links is empty or undefined", () => {
    act(() => {
      root.render(React.createElement(SocialLinks, { links: [] }));
    });
    expect(container.innerHTML).toBe("");

    act(() => {
      root.render(React.createElement(SocialLinks, { links: undefined }));
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders social links with accessibility attributes and 44px min touch target", () => {
    const mockLinks: SiteSocialLinkViewModel[] = [
      { id: "1", platform: "x", label: "X profile", url: "https://x.com/vibress", iconUrl: "/social-icons/x.svg" },
      { id: "2", platform: "github", label: "GitHub organization", url: "https://github.com/vibress", iconUrl: "/social-icons/github.svg" },
    ];

    act(() => {
      root.render(React.createElement(SocialLinks, { links: mockLinks, locale: "en", className: "custom-social-class" }));
    });

    const nav = container.querySelector("nav");
    expect(nav).toBeDefined();
    expect(nav?.getAttribute("aria-label")).toBe("Social media links");
    expect(nav?.getAttribute("dir")).toBe("ltr");
    expect(nav?.classList.contains("custom-social-class")).toBe(true);

    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(2);

    expect(anchors[0]?.getAttribute("href")).toBe("https://x.com/vibress");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(anchors[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchors[0]?.getAttribute("aria-label")).toBe("X profile");
    expect(anchors[0]?.style.minWidth).toBe("44px");
    expect(anchors[0]?.style.minHeight).toBe("44px");

    const img = anchors[0]?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/social-icons/x.svg");
    expect(img?.getAttribute("loading")).toBe("lazy");

    expect(anchors[1]?.getAttribute("href")).toBe("https://github.com/vibress");
    expect(anchors[1]?.getAttribute("aria-label")).toBe("GitHub organization");
  });

  it("supports Arabic and RTL locale labels", () => {
    const mockLinks: SiteSocialLinkViewModel[] = [
      { id: "1", platform: "instagram", label: "انستغرام", url: "https://instagram.com/vibress", iconUrl: "/social-icons/instagram.svg" },
    ];

    act(() => {
      root.render(React.createElement(SocialLinks, { links: mockLinks, locale: "ar-SA" }));
    });

    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("روابط التواصل الاجتماعي");
    expect(nav?.getAttribute("dir")).toBe("rtl");
  });
});
