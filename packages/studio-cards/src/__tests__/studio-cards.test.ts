import { describe, it, expect } from "vitest";
import {
  STUDIO_CARD_DEFINITIONS,
  ImageCardDefinition,
  GalleryCardDefinition,
  VideoCardDefinition,
  AudioCardDefinition,
  FileCardDefinition,
  BookmarkCardDefinition,
  EmbedCardDefinition,
  ButtonCardDefinition,
  CalloutCardDefinition,
  ToggleCardDefinition,
  MarkdownCardDefinition,
  HtmlCardDefinition,
  DividerCardDefinition,
} from "../index";

describe("Studio Card Definitions", () => {
  it("contains all 13 card definitions", () => {
    const types = Object.keys(STUDIO_CARD_DEFINITIONS);
    expect(types).toEqual([
      "image",
      "gallery",
      "video",
      "audio",
      "file",
      "bookmark",
      "embed",
      "button",
      "callout",
      "toggle",
      "markdown",
      "html",
      "divider",
    ]);
  });

  describe("ImageCard", () => {
    it("validates and renders standard image with caption and dimensions", () => {
      const data = ImageCardDefinition.validate({
        src: "https://example.com/photo.jpg",
        alt: "Sample alt",
        caption: "A scenic photo",
        width: 1200,
        height: 800,
      });
      const html = ImageCardDefinition.renderHtml(data);
      expect(html).toContain('src="https://example.com/photo.jpg"');
      expect(html).toContain('alt="Sample alt"');
      expect(html).toContain('width="1200" height="800"');
      expect(html).toContain("<figcaption>A scenic photo</figcaption>");
      expect(ImageCardDefinition.renderPlainText(data)).toBe("A scenic photo");
    });
  });

  describe("CalloutCard", () => {
    it("validates and renders callout with emoji and custom color", () => {
      const data = CalloutCardDefinition.validate({
        text: "<strong>Important:</strong> Please read before continuing.",
        emoji: "⚠️",
        backgroundColor: "amber",
      });
      const html = CalloutCardDefinition.renderHtml(data);
      expect(html).toContain("kg-callout-card");
      expect(html).toContain("bg-amber");
      expect(html).toContain("⚠️");
      expect(html).toContain("<strong>Important:</strong>");
    });
  });

  describe("ToggleCard", () => {
    it("validates and renders details toggle accordion", () => {
      const data = ToggleCardDefinition.validate({
        heading: "FAQ Question",
        content: "Detailed answer goes here.",
      });
      const html = ToggleCardDefinition.renderHtml(data);
      expect(html).toContain("<details class=\"kg-card kg-toggle-card\"><summary>FAQ Question</summary>");
      expect(html).toContain("<div>Detailed answer goes here.</div>");
      expect(ToggleCardDefinition.renderPlainText(data)).toBe("FAQ Question\nDetailed answer goes here.");
    });
  });

  describe("ButtonCard", () => {
    it("validates and renders centered action button", () => {
      const data = ButtonCardDefinition.validate({
        text: "Subscribe Now",
        url: "https://example.com/subscribe",
        alignment: "center",
      });
      const html = ButtonCardDefinition.renderHtml(data);
      expect(html).toContain('class="kg-card kg-button-card align-center"');
      expect(html).toContain('href="https://example.com/subscribe"');
      expect(html).toContain("Subscribe Now");
    });
  });

  describe("BookmarkCard", () => {
    it("validates and renders rich bookmark preview", () => {
      const data = BookmarkCardDefinition.validate({
        url: "https://vibress.com/blog",
        title: "Vibress Platform",
        description: "Modern publishing powerhouse",
      });
      const html = BookmarkCardDefinition.renderHtml(data);
      expect(html).toContain("kg-bookmark-card");
      expect(html).toContain('<div class="title">Vibress Platform</div>');
      expect(html).toContain('<div class="desc">Modern publishing powerhouse</div>');
    });
  });

  describe("EmbedCard", () => {
    it("safely embeds supported providers like YouTube", () => {
      const data = EmbedCardDefinition.validate({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
      const html = EmbedCardDefinition.renderHtml(data);
      expect(html).toContain("<iframe");
      expect(html).toContain("allowfullscreen");
    });
  });
});
