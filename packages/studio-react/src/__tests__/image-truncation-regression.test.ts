import { describe, it, expect, vi } from "vitest";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  ParagraphNode,
  TextNode,
} from "lexical";
import { $createHeadingNode } from "@lexical/rich-text";
import { STUDIO_CORE_NODES } from "@vibress/studio-nodes";
import { StudioCardNode } from "@vibress/studio-cards";
import {
  ReactStudioCardNode,
  $createReactStudioCardNode,
  $isReactStudioCardNode,
} from "../nodes/ReactStudioCardNode";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import { migrateDocument } from "@vibress/studio-core";
import { renderStudioDocumentToHtml } from "@vibress/studio-renderer";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function generateWords(count: number): string {
  const vocabulary = [
    "architecture", "performance", "scalability", "distributed", "systems",
    "rendering", "typography", "editorial", "publishing", "sovereign",
    "decentralized", "interfaces", "resilience", "composable", "hydration",
    "persistence", "transaction", "synchronization", "invariants", "determinism"
  ];
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const term = vocabulary[i % vocabulary.length];
    words.push(`${term}`);
  }
  return words.join(" ");
}

describe("VIBRESS STUDIO — IMAGE INSERTION CONTENT LOSS REGRESSION SUITE", () => {
  function setupEditor() {
    return createEditor({
      nodes: [
        ...STUDIO_CORE_NODES,
        ReactStudioCardNode,
        StudioCardNode,
        {
          replace: StudioCardNode,
          with: (node: StudioCardNode) =>
            new ReactStudioCardNode(node.getCardType(), node.getCardData()),
        },
      ],
    });
  }

  // =========================================================================
  // CRITICAL REGRESSION TEST #1: 2000+ Word TextNode with /image Insertion
  // =========================================================================
  it("CRITICAL REGRESSION #1: 2000+ word article maintains word count when /image is inserted inside long TextNode", () => {
    const editor = setupEditor();
    const longText2000 = generateWords(2050);

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("The 2000-Word Comprehensive Treatise on Digital Systems"));
      root.append(h1);

      const p = $createParagraphNode();
      // Single long TextNode containing 2050 words followed by slash trigger
      const textNode = $createTextNode(`${longText2000} /image`);
      p.append(textNode);
      root.append(p);

      const pAfter = $createParagraphNode();
      pAfter.append($createTextNode("Post-scriptum concluding paragraph of the long article."));
      root.append(pAfter);
    }, { discrete: true });

    const beforeWords = countWords(editor.getEditorState().read(() => $getRoot().getTextContent()));
    expect(beforeWords).toBeGreaterThanOrEqual(2050);

    // Perform the precise trigger trimming simulation as executed by SlashMenuPlugin
    editor.update(() => {
      const root = $getRoot();
      const p = root.getChildren()[1] as ParagraphNode;
      const textNode = p.getFirstChild() as TextNode;
      const textContent = textNode.getTextContent();
      const queryString = "image";

      const slashIdx = textContent.lastIndexOf("/");
      expect(slashIdx).toBeGreaterThan(0);

      const queryLen = queryString.length + 1;
      const prefix = textContent.slice(0, slashIdx);
      const suffix = textContent.slice(Math.min(textContent.length, slashIdx + queryLen));
      const newText = prefix + suffix;

      textNode.setTextContent(newText);
      textNode.select(prefix.length, prefix.length);

      const imageCard = $createReactStudioCardNode("image", {
        src: "https://example.com/production-diagram.png",
        alt: "System Architecture",
        caption: "Figure 1: Full System Overview",
      });
      p.insertAfter(imageCard);
    }, { discrete: true });

    // Verify word count after insertion
    const afterWords = countWords(editor.getEditorState().read(() => $getRoot().getTextContent()));
    expect(afterWords).toBeGreaterThanOrEqual(2050);

    // Verify node hierarchy and integrity
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      expect(children.length).toBe(4);
      expect(children[0]?.getType()).toBe("heading");
      expect(children[1]?.getType()).toBe("paragraph");
      expect(countWords(children[1]?.getTextContent() || "")).toBeGreaterThanOrEqual(2045);
      expect(children[2]?.getType()).toBe("react-studio-card");
      expect(children[3]?.getType()).toBe("paragraph");
    });
  });

  // =========================================================================
  // CRITICAL REGRESSION TEST #2: Destructive Recovery Isolation
  // =========================================================================
  it("CRITICAL REGRESSION #2: Invalid card data does NOT trigger root.clear() or truncate surrounding document", () => {
    const editor = setupEditor();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("Document with Invalid Card"));
      root.append(h1);

      const p1 = $createParagraphNode();
      p1.append($createTextNode("Important introductory analysis before invalid payload."));
      root.append(p1);

      // Incomplete/invalid card data (e.g. empty or unexpected properties)
      const invalidCard = $createReactStudioCardNode("image", {
        invalidKey: 12345,
        unexpected: null,
      });
      root.append(invalidCard);

      const p2 = $createParagraphNode();
      p2.append($createTextNode("Crucial concluding evaluation after invalid payload."));
      root.append(p2);
    }, { discrete: true });

    const rootChildrenBefore = editor.getEditorState().read(() => $getRoot().getChildren().length);
    expect(rootChildrenBefore).toBe(4);

    // Serialize and deserialize
    const serialized = editor.getEditorState().read(() => {
      return serializeStudioDocument(editor.getEditorState().toJSON().root);
    });

    const reloadEditor = setupEditor();
    const migrated = migrateDocument(serialized);
    const parsedState = reloadEditor.parseEditorState({
      root: { ...migrated.root, version: 1 },
    } as never);
    reloadEditor.setEditorState(parsedState);

    reloadEditor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      // Verify root was NEVER wiped out into an empty single paragraph
      expect(children.length).toBe(4);
      expect(children[0]?.getTextContent()).toBe("Document with Invalid Card");
      expect(children[1]?.getTextContent()).toBe("Important introductory analysis before invalid payload.");
      expect(children[2]?.getType()).toBe("react-studio-card");
      expect(children[3]?.getTextContent()).toBe("Crucial concluding evaluation after invalid payload.");
    });

    consoleErrorSpy.mockRestore();
  });

  // =========================================================================
  // SELECTION REQUIREMENTS SUITE (10 Explicit Test Cases)
  // =========================================================================

  // 1. /image in a short paragraph
  it("Case 1: /image in a short paragraph preserves paragraph text", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      const t = $createTextNode("Short note /image");
      p.append(t);
      root.append(p);

      const slashIdx = t.getTextContent().lastIndexOf("/");
      t.setTextContent(t.getTextContent().slice(0, slashIdx));
      const card = $createReactStudioCardNode("image", { src: "https://example.com/i.jpg" });
      p.insertAfter(card);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(2);
      expect(root.getChildren()[0]?.getTextContent()).toBe("Short note ");
    });
  });

  // 2. /image in a 2000+ word TextNode
  it("Case 2: /image in a 2000+ word TextNode preserves full 2000 words", () => {
    const editor = setupEditor();
    const text2000 = generateWords(2000);
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      const t = $createTextNode(`${text2000} /image`);
      p.append(t);
      root.append(p);

      const slashIdx = t.getTextContent().lastIndexOf("/");
      t.setTextContent(t.getTextContent().slice(0, slashIdx));
      const card = $createReactStudioCardNode("image", { src: "https://example.com/i.jpg" });
      p.insertAfter(card);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(countWords(root.getChildren()[0]?.getTextContent() || "")).toBeGreaterThanOrEqual(2000);
    });
  });

  // 3. /image in middle of paragraph
  it("Case 3: /image in middle of paragraph splits and preserves both halves", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      const t = $createTextNode("First segment before /image second segment after");
      p.append(t);
      root.append(p);

      const content = t.getTextContent();
      const slashIdx = content.indexOf("/image");
      const queryLen = 6;
      const prefix = content.slice(0, slashIdx);
      const suffix = content.slice(slashIdx + queryLen);

      // Split into prefix paragraph, card, and suffix paragraph
      t.setTextContent(prefix);
      const card = $createReactStudioCardNode("image", { src: "https://example.com/i.jpg" });
      const pSuffix = $createParagraphNode();
      pSuffix.append($createTextNode(suffix));

      p.insertAfter(card);
      card.insertAfter(pSuffix);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(3);
      expect(root.getChildren()[0]?.getTextContent()).toBe("First segment before ");
      expect(root.getChildren()[1]?.getType()).toBe("react-studio-card");
      expect(root.getChildren()[2]?.getTextContent()).toBe(" second segment after");
    });
  });

  // 4. /image at paragraph end
  it("Case 4: /image at paragraph end preserves all preceding text", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      const t = $createTextNode("Paragraph content finishing here. /image");
      p.append(t);
      root.append(p);

      const slashIdx = t.getTextContent().lastIndexOf("/");
      t.setTextContent(t.getTextContent().slice(0, slashIdx));
      const card = $createReactStudioCardNode("image", { src: "https://example.com/i.jpg" });
      p.insertAfter(card);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren()[0]?.getTextContent()).toBe("Paragraph content finishing here. ");
    });
  });

  // 5. /image on an isolated line
  it("Case 5: /image on an isolated line replaces isolated trigger and preserves neighbors", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p1 = $createParagraphNode();
      p1.append($createTextNode("Paragraph 1"));
      root.append(p1);

      const pSlash = $createParagraphNode();
      const tSlash = $createTextNode("/image");
      pSlash.append(tSlash);
      root.append(pSlash);

      const p2 = $createParagraphNode();
      p2.append($createTextNode("Paragraph 2"));
      root.append(p2);

      tSlash.remove();
      const card = $createReactStudioCardNode("image", { src: "https://example.com/i.jpg" });
      pSlash.replace(card);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(3);
      expect(root.getChildren()[0]?.getTextContent()).toBe("Paragraph 1");
      expect(root.getChildren()[1]?.getType()).toBe("react-studio-card");
      expect(root.getChildren()[2]?.getTextContent()).toBe("Paragraph 2");
    });
  });

  // 6. image inserted using MediaPicker
  it("Case 6: image inserted using MediaPicker updates cardData without mutating surrounding tree", () => {
    const editor = setupEditor();
    let cardKey = "";
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode("Article text before picker"));
      root.append(p);

      const card = $createReactStudioCardNode("image", {});
      root.append(card);
      cardKey = card.getKey();
    }, { discrete: true });

    // Simulate async MediaPicker selection resolution
    editor.update(() => {
      const card = $getNodeByKey(cardKey);
      if ($isReactStudioCardNode(card)) {
        card.setCardData({
          assetId: "picker-asset-789",
          src: "https://example.com/picker-result.png",
          alt: "Selected Media",
        });
      }
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(2);
      expect(root.getChildren()[0]?.getTextContent()).toBe("Article text before picker");
      const card = root.getChildren()[1];
      expect($isReactStudioCardNode(card)).toBe(true);
      if ($isReactStudioCardNode(card)) {
        expect(card.getCardData().src).toBe("https://example.com/picker-result.png");
      }
    });
  });

  // 7. image inserted after existing content
  it("Case 7: image inserted after existing content appends cleanly", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode("Existing content header"));
      root.append(p);

      const card = $createReactStudioCardNode("image", { src: "https://example.com/appended.jpg" });
      root.append(card);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(2);
      expect(root.getChildren()[0]?.getTextContent()).toBe("Existing content header");
      expect(root.getChildren()[1]?.getType()).toBe("react-studio-card");
    });
  });

  // 8. image inserted before existing content
  it("Case 8: image inserted before existing content prepends cleanly", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode("Existing content body"));
      root.append(p);

      const card = $createReactStudioCardNode("image", { src: "https://example.com/hero.jpg" });
      p.insertBefore(card);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(2);
      expect(root.getChildren()[0]?.getType()).toBe("react-studio-card");
      expect(root.getChildren()[1]?.getTextContent()).toBe("Existing content body");
    });
  });

  // 9. image upload completion
  it("Case 9: image upload completion only updates target node attributes", () => {
    const editor = setupEditor();
    let cardKey = "";
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p1 = $createParagraphNode();
      p1.append($createTextNode("Paragraph 1"));
      root.append(p1);

      const card = $createReactStudioCardNode("image", {});
      root.append(card);
      cardKey = card.getKey();

      const p2 = $createParagraphNode();
      p2.append($createTextNode("Paragraph 2"));
      root.append(p2);
    }, { discrete: true });

    // Async upload completed
    editor.update(() => {
      const card = $getNodeByKey(cardKey);
      if ($isReactStudioCardNode(card)) {
        card.setCardData({
          assetId: "upload-complete-1",
          src: "https://cdn.example.com/uploaded.webp",
          width: 1920,
          height: 1080,
        });
      }
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(3);
      expect(root.getChildren()[0]?.getTextContent()).toBe("Paragraph 1");
      expect(root.getChildren()[2]?.getTextContent()).toBe("Paragraph 2");
      const card = root.getChildren()[1];
      if ($isReactStudioCardNode(card)) {
        expect(card.getCardData().width).toBe(1920);
        expect(card.getCardData().src).toBe("https://cdn.example.com/uploaded.webp");
      }
    });
  });

  // 10. autosave after insertion
  it("Case 10: autosave after insertion serializes the complete AST without loss", () => {
    const editor = setupEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p1 = $createParagraphNode();
      p1.append($createTextNode("Autosave test paragraph 1"));
      root.append(p1);

      const card = $createReactStudioCardNode("image", {
        src: "https://example.com/autosave.png",
        alt: "Autosave",
      });
      root.append(card);

      const p2 = $createParagraphNode();
      p2.append($createTextNode("Autosave test paragraph 2"));
      root.append(p2);
    }, { discrete: true });

    // Simulate autosave serialization
    const serializedDoc = editor.getEditorState().read(() => {
      return serializeStudioDocument(editor.getEditorState().toJSON().root);
    });

    expect(serializedDoc.schema).toBe("vibress-studio");
    expect(serializedDoc.root.children.length).toBe(3);

    const html = renderStudioDocumentToHtml(serializedDoc);
    expect(html).toContain("<p>Autosave test paragraph 1</p>");
    expect(html).toContain('src="https://example.com/autosave.png"');
    expect(html).toContain("<p>Autosave test paragraph 2</p>");
  });
});
