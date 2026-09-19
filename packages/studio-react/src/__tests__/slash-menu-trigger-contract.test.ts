import { describe, it, expect } from "vitest";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  TextNode,
  ElementNode,
} from "lexical";
import { STUDIO_CORE_NODES } from "@vibress/studio-nodes";
import { StudioCardNode } from "@vibress/studio-cards";
import { ReactStudioCardNode, $createReactStudioCardNode } from "../nodes/ReactStudioCardNode";

// Replicates the exact trigger extraction and surgical removal logic from SlashMenuPlugin.tsx
function executeSlashMenuOptionRemoval(
  nodeToRemove: TextNode | null,
  queryString: string | null,
  matchingString?: string,
) {
  if (!nodeToRemove) return;

  const query = matchingString ?? queryString ?? "";
  const textContent = nodeToRemove.getTextContent();
  const triggerQuery = "/" + query;

  // 1. Authoritative check: If nodeToRemove was already split by Lexical,
  // it contains only the trigger + query.
  if (
    textContent === triggerQuery ||
    textContent === "/" ||
    textContent.trim() === triggerQuery
  ) {
    nodeToRemove.remove();
    return;
  }

  // 2. Authoritative selection check: if caret is inside nodeToRemove
  let triggerStart = -1;
  let triggerLen = triggerQuery.length;

  const selection = $getSelection();
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    const anchor = selection.anchor;
    if (anchor.getNode().getKey() === nodeToRemove.getKey()) {
      const caret = anchor.offset;
      if (
        caret >= triggerLen &&
        textContent.slice(caret - triggerLen, caret) === triggerQuery
      ) {
        triggerStart = caret - triggerLen;
      }
    }
  }

  // 3. Fallback: match Lexical typeahead trigger pattern (^|\s|\()(/query)
  if (triggerStart === -1) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("(^|\\s|\\()(\\/" + escapedQuery + ")", "g");
    let match: RegExpExecArray | null;
    let lastMatchIdx = -1;
    while ((match = regex.exec(textContent)) !== null) {
      lastMatchIdx = match.index + (match[1]?.length ?? 0);
    }
    if (lastMatchIdx !== -1) {
      triggerStart = lastMatchIdx;
    } else {
      triggerStart = textContent.lastIndexOf("/");
      triggerLen = query.length + 1;
    }
  }

  if (triggerStart !== -1) {
    const prefix = textContent.slice(0, triggerStart);
    const suffix = textContent.slice(triggerStart + triggerLen);
    const newText = prefix + suffix;
    if (newText.length > 0) {
      nodeToRemove.setTextContent(newText);
      nodeToRemove.select(prefix.length, prefix.length);
    } else {
      nodeToRemove.remove();
    }
  } else {
    nodeToRemove.remove();
  }
}

describe("SlashMenuPlugin Trigger Contract & Surgical Removal Suite", () => {
  function setupEditor() {
    return createEditor({
      nodes: [...STUDIO_CORE_NODES, ReactStudioCardNode, StudioCardNode],
    });
  }

  it("Test Case 1: URL before /image preserves full URL and preceding slashes", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const textNode = $createTextNode("Check out our site at https://example.com/api/v1/resource /image");
        p.append(textNode);
        root.append(p);

        // Caret at the end of /image (offset 64)
        textNode.select(64, 64);

        executeSlashMenuOptionRemoval(textNode, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        p.append(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.length).toBe(2);
      expect(children?.[0]?.getTextContent()).toBe("Check out our site at https://example.com/api/v1/resource ");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("Test Case 2: multiple '/' characters before /image (fractions, dates, ratios)", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const textNode = $createTextNode("Operating 24/7 with 100/100 uptime and A/B/C testing /image");
        p.append(textNode);
        root.append(p);

        textNode.select(textNode.getTextContent().length, textNode.getTextContent().length);

        executeSlashMenuOptionRemoval(textNode, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        p.append(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.[0]?.getTextContent()).toBe("Operating 24/7 with 100/100 uptime and A/B/C testing ");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("Test Case 3: multiple slash commands in the same text node (author selects one)", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        // Suppose text has an earlier text snippet like "/quote" and author is now triggering "/image"
        const textNode = $createTextNode("Here we mention /quote in text and now we insert /image");
        p.append(textNode);
        root.append(p);

        textNode.select(textNode.getTextContent().length, textNode.getTextContent().length);

        executeSlashMenuOptionRemoval(textNode, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        p.append(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.[0]?.getTextContent()).toBe("Here we mention /quote in text and now we insert ");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("Test Case 4: Arabic text containing '/' (RTL text with Gregorian/Hijri dates)", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const textNode = $createTextNode("تم نشر التقرير بتاريخ 18/09/2026 في المنصة /image");
        p.append(textNode);
        root.append(p);

        textNode.select(textNode.getTextContent().length, textNode.getTextContent().length);

        executeSlashMenuOptionRemoval(textNode, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        p.append(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.[0]?.getTextContent()).toBe("تم نشر التقرير بتاريخ 18/09/2026 في المنصة ");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("Test Case 5: slash immediately after punctuation and spaced slash triggers", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        // In Lexical, trigger regex requires whitespace, start-of-line, or open-paren: (^|\s|\()(/query)
        // Spaced slash after period: "End of discussion. /image"
        const textNode = $createTextNode("End of discussion. /image");
        p.append(textNode);
        root.append(p);

        textNode.select(textNode.getTextContent().length, textNode.getTextContent().length);

        executeSlashMenuOptionRemoval(textNode, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        p.append(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.[0]?.getTextContent()).toBe("End of discussion. ");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("Test Case 6: /image in the middle of a long TextNode with trailing slashes and dates", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        // A long text node where /image is in the middle, and subsequent text contains a date like 2024/09/18
        const fullText = "Beginning of article paragraph with deep technical analysis. /image and subsequent concluding remarks referencing timestamp 2026/09/18 in the system.";
        const textNode = $createTextNode(fullText);
        p.append(textNode);
        root.append(p);

        // Caret is placed at the end of "/image" (index 67)
        const triggerEnd = fullText.indexOf("/image") + "/image".length;
        textNode.select(triggerEnd, triggerEnd);

        executeSlashMenuOptionRemoval(textNode, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        p.append(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.[0]?.getTextContent()).toBe("Beginning of article paragraph with deep technical analysis.  and subsequent concluding remarks referencing timestamp 2026/09/18 in the system.");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("Lexical Native Split Contract: isolated split node is cleanly removed leaving siblings untouched", () => {
    const editor = setupEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const t1 = $createTextNode("Prefix text with https://example.com/path/to/resource ");
        const t2 = $createTextNode("/image");
        const t3 = $createTextNode(" and trailing words with 2026/09/18 timestamp.");
        p.append(t1, t2, t3);
        root.append(p);

        t2.select(6, 6);

        // Under Lexical's native $splitNodeContainingQuery contract, nodeToRemove is t2
        executeSlashMenuOptionRemoval(t2, "image", "image");

        const card = $createReactStudioCardNode("image", { src: "https://example.com/pic.jpg" });
        t1.insertAfter(card);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild<ElementNode>();
      const children = p?.getChildren();
      expect(children?.length).toBe(3);
      expect(children?.[0]?.getTextContent()).toBe("Prefix text with https://example.com/path/to/resource ");
      expect(children?.[1]?.getType()).toBe("react-studio-card");
      expect(children?.[2]?.getTextContent()).toBe(" and trailing words with 2026/09/18 timestamp.");
    });
  });
});
