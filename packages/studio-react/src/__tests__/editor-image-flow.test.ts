import { describe, it, expect } from "vitest";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from "lexical";
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

describe("Studio Editor Image Insertion & Persistence Flow", () => {
  function setupEditor() {
    return createEditor({
      nodes: [
        ...STUDIO_CORE_NODES,
        ReactStudioCardNode,
        StudioCardNode,
        {
          replace: StudioCardNode,
          with: (node: StudioCardNode) => {
            return new ReactStudioCardNode(
              node.getCardType(),
              node.getCardData(),
            );
          },
        },
      ],
    });
  }

  it("preserves all text paragraphs when inserting an image card", () => {
    const editor = setupEditor();

    // 1. User writes 3 paragraphs of text
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const p1 = $createParagraphNode();
      p1.append($createTextNode("First paragraph of important article."));
      root.append(p1);

      const p2 = $createParagraphNode();
      p2.append($createTextNode("Second paragraph before the image."));
      root.append(p2);

      const p3 = $createParagraphNode();
      p3.append($createTextNode("Third paragraph after the image."));
      root.append(p3);
    }, { discrete: true });

    // Verify initial text
    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().length).toBe(3);
      expect(root.getTextContent()).toContain("First paragraph");
      expect(root.getTextContent()).toContain("Second paragraph");
      expect(root.getTextContent()).toContain("Third paragraph");
    });

    // 2. User inserts an image card between p2 and p3
    let insertedNodeKey = "";
    editor.update(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const p2 = children[1];
      expect(p2).toBeDefined();

      // Create card node
      const cardNode = $createReactStudioCardNode("image", {});
      p2!.insertAfter(cardNode);
      insertedNodeKey = cardNode.getKey();
    }, { discrete: true });

    // 3. Media picker updates the card data
    editor.update(() => {
      const root = $getRoot();
      const cardNode = root.getChildren().find((n) => n.getKey() === insertedNodeKey);
      expect(cardNode).toBeDefined();
      if ($isReactStudioCardNode(cardNode)) {
        cardNode.setCardData({
          assetId: "asset-123",
          src: "https://example.com/uploaded-image.png",
          alt: "My beautiful uploaded image",
          caption: "A photo of the landscape",
        });
      }
    }, { discrete: true });

    // 4. Serialize the document (as OnChangePlugin / saving does)
    const serializedDoc = editor.getEditorState().read(() => {
      const rootJSON = editor.getEditorState().toJSON().root;
      return serializeStudioDocument(rootJSON);
    });

    expect(serializedDoc.schema).toBe("vibress-studio");
    expect(serializedDoc.root.children.length).toBe(4);

    // 5. Parse the serialized document into a fresh editor (like page load / version change)
    const editor2 = setupEditor();
    const migrated = migrateDocument(serializedDoc);
    const parsedState = editor2.parseEditorState({
      root: { ...migrated.root, version: 1 },
    } as never);
    editor2.setEditorState(parsedState);

    // 6. Verify all text and the card are completely intact in the new editor
    editor2.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      expect(children.length).toBe(4);

      expect(children[0]?.getTextContent()).toBe("First paragraph of important article.");
      expect(children[1]?.getTextContent()).toBe("Second paragraph before the image.");
      expect(children[2]?.getType()).toBe("react-studio-card");
      expect($isReactStudioCardNode(children[2])).toBe(true);
      if ($isReactStudioCardNode(children[2])) {
        expect(children[2].getCardData().src).toBe("https://example.com/uploaded-image.png");
        expect(children[2].getCardData().alt).toBe("My beautiful uploaded image");
      }
      expect(children[3]?.getTextContent()).toBe("Third paragraph after the image.");
    });

    // 7. Verify public HTML renderer produces full text + image figure
    const html = renderStudioDocumentToHtml(serializedDoc);
    expect(html).toContain("<p>First paragraph of important article.</p>");
    expect(html).toContain("<p>Second paragraph before the image.</p>");
    expect(html).toContain('src="https://example.com/uploaded-image.png"');
    expect(html).toContain('alt="My beautiful uploaded image"');
    expect(html).toContain("<figcaption>A photo of the landscape</figcaption>");
    expect(html).toContain("<p>Third paragraph after the image.</p>");
    expect(html).not.toContain("Content rendering unavailable");
  });

  it("safely handles slash command at the end of existing text without losing preceding text", () => {
    const editor = setupEditor();

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const p = $createParagraphNode();
      const textNode = $createTextNode("Here is 1500 words of article text. /image");
      p.append(textNode);
      root.append(p);

      // Simulate SlashMenuPlugin onSelectOption logic
      const textContent = textNode.getTextContent();
      const slashIdx = textContent.lastIndexOf("/");
      if (slashIdx > 0) {
        textNode.setTextContent(textContent.slice(0, slashIdx));
      } else {
        textNode.remove();
      }

      // Insert card
      const cardNode = $createReactStudioCardNode("image", {
        src: "https://example.com/photo.jpg",
        alt: "Inline photo",
      });
      p.insertAfter(cardNode);
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      expect(children.length).toBe(2);
      expect(children[0]?.getTextContent()).toBe("Here is 1500 words of article text. ");
      expect(children[1]?.getType()).toBe("react-studio-card");
    });
  });

  it("handles unpopulated/empty image cards gracefully without errors in serializer and renderer", () => {
    const emptyCardDoc = {
      schema: "vibress-studio",
      version: 1,
      editor: { lexicalVersion: "0.13.1" },
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Introduction text", format: 0, version: 1 }],
            version: 1,
          },
          {
            type: "studio-card",
            cardType: "image",
            cardData: {},
            version: 1,
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: "Conclusion text", format: 0, version: 1 }],
            version: 1,
          },
        ],
        version: 1,
      },
    };

    const html = renderStudioDocumentToHtml(emptyCardDoc);
    expect(html).toContain("<p>Introduction text</p>");
    expect(html).toContain("<p>Conclusion text</p>");
    expect(html).not.toContain("Content rendering unavailable");
  });
});
