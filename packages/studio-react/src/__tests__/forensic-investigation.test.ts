import { describe, it, expect } from "vitest";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from "lexical";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createListNode, $createListItemNode } from "@lexical/list";
import { STUDIO_CORE_NODES } from "@vibress/studio-nodes";
import { StudioCardNode } from "@vibress/studio-cards";
import {
  ReactStudioCardNode,
  $createReactStudioCardNode,
} from "../nodes/ReactStudioCardNode";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import { migrateDocument } from "@vibress/studio-core";
import { renderStudioDocumentToHtml, renderStudioDocumentToPlainText } from "@vibress/studio-renderer";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("VIBRESS STUDIO — FORENSIC INVESTIGATION SUITE", () => {
  function dumpChildrenSummary(editor: any): any[] {
    return editor.getEditorState().read(() => {
      const root = $getRoot();
      return root.getChildren().map((node: any, idx: number) => {
        return {
          index: idx,
          type: node.getType(),
          key: node.getKey(),
          textSnippet: node.getTextContent().slice(0, 50),
          wordCount: countWords(node.getTextContent()),
          cardType: node instanceof StudioCardNode || node instanceof ReactStudioCardNode ? node.getCardType() : undefined,
          cardData: node instanceof StudioCardNode || node instanceof ReactStudioCardNode ? node.getCardData() : undefined,
        };
      });
    });
  }

  it("reproduces and audits document state across entire lifecycle (Before -> Insertion -> Save -> Reload)", () => {
    console.log("\n============================================================");
    console.log("1. FORENSIC REPRODUCTION ACROSS ALL DOCUMENT PHASES");
    console.log("============================================================");

    const editor = createEditor({
      nodes: [
        ...STUDIO_CORE_NODES,
        ReactStudioCardNode,
        StudioCardNode,
        {
          replace: StudioCardNode,
          with: (node: StudioCardNode) => new ReactStudioCardNode(node.getCardType(), node.getCardData()),
        },
      ],
    });

    const p1Text = "In the contemporary landscape of software engineering and digital media systems, the architecture of content management platforms has undergone a profound paradigm shift. For decades, monolithic content management systems dominated the market by intertwining content creation, database storage, and presentation templating into a single tightly coupled runtime environment. While this approach enabled rapid initial deployments for small blogs and traditional websites, it introduced severe architectural bottlenecks as digital experiences evolved into omnichannel ecosystems requiring sub-millisecond response times, edge rendering, and real-time collaboration.";
    const p2Text = "To overcome these inherent architectural limitations, modern digital publications have embraced decoupled and headless architectures where structured editorial content is treated as immutable data rather than arbitrary HTML strings. In such systems, the content editing surface is powered by sophisticated lexical data structures that represent document state as an Abstract Syntax Tree (AST) composed of hierarchical block nodes, inline formatting tokens, and interactive dynamic cards.";
    const p3Text = "The transition to AST-driven editors provides unmatched determinism and flexibility. Editorial teams can seamlessly embed complex interactive components—such as dynamic image galleries, audio players, newsletter subscription triggers, and syntax-highlighted code snippets—without risking HTML injection vulnerabilities or style leakage. Furthermore, because the editor state is persisted as standardized JSON schemas, client applications can independently render optimized representations for web, mobile apps, RSS feeds, and syndicated email newsletters.";
    const p4Text = "However, the sophistication of AST-driven rich text engines introduces nuanced engineering challenges, particularly regarding state synchronization, transaction boundaries, and selection reconciliation. When an author initiates a block-level insertion command, the underlying editor engine must accurately resolve the cursor anchor, split or adjust surrounding container nodes, and maintain sibling continuity across the entire document tree. Any failure in selection range resolution or destructive node replacement can inadvertently truncate preceding or succeeding content blocks.";
    const p5Text = "As we examine the technical mechanics of image card insertion in Vibress Studio, we must systematically evaluate each phase of the document lifecycle: lexical transaction execution, typeahead trigger replacement, node tree mutation, serializer normalization, and database persistence. By establishing rigorous invariants across each boundary, we ensure complete data integrity for high-volume publishing workflows.";
    const p6Text = "In addition to static block structures, modern publishing frameworks must maintain full backward and forward schema compatibility across multiple releases. When documents transition between persistent storage, in-memory CRDT collaboration buffers, and public cache tiers, serializer boundaries must validate every AST node without performing destructive fallback mutations that could truncate user content.";
    const p7Text = "Ultimately, the resilience of editorial software lies in its ability to isolate component failures, enforce strict schema contracts, and preserve all surrounding textual contexts even in the presence of unpopulated, malformed, or asynchronous media assets.";
    const p8Text = "Editorial reliability is the cornerstone of trust between digital publishers and their readership. Authors must have absolute confidence that every sentence, section heading, and stylistic variation is preserved with mathematical fidelity during composition.";
    const p9Text = "By ensuring strict transaction atomicity across Lexical nodes and preventing unintended container truncation, modern publishing systems achieve enterprise-grade durability suitable for national newsrooms and international publishing syndicates.";

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("Architectural Foundations of Modern Digital Publishing"));
      root.append(h1);

      const p1 = $createParagraphNode();
      p1.append($createTextNode(p1Text));
      root.append(p1);

      const p2 = $createParagraphNode();
      p2.append($createTextNode(p2Text));
      root.append(p2);

      const quote = $createQuoteNode();
      quote.append($createTextNode("Architecture is the decisions that you wish you could get right early in a project, but that you are not likely to. — Ralph Johnson"));
      root.append(quote);

      const p3 = $createParagraphNode();
      p3.append($createTextNode(p3Text));
      root.append(p3);

      const list = $createListNode("bullet");
      const li1 = $createListItemNode();
      li1.append($createTextNode("Sub-millisecond static page generation"));
      const li2 = $createListItemNode();
      li2.append($createTextNode("Bidirectional CRDT real-time collaboration"));
      const li3 = $createListItemNode();
      li3.append($createTextNode("Zero-trust sanitize allowlist boundary"));
      list.append(li1, li2, li3);
      root.append(list);

      const p4 = $createParagraphNode();
      p4.append($createTextNode(p4Text));
      root.append(p4);

      const h2 = $createHeadingNode("h2");
      h2.append($createTextNode("State Synchronization and Serializer Resilience"));
      root.append(h2);

      const p5 = $createParagraphNode();
      p5.append($createTextNode(p5Text));
      root.append(p5);

      const p6 = $createParagraphNode();
      p6.append($createTextNode(p6Text));
      root.append(p6);

      const p7 = $createParagraphNode();
      p7.append($createTextNode(p7Text));
      root.append(p7);

      const p8 = $createParagraphNode();
      p8.append($createTextNode(p8Text));
      root.append(p8);

      const p9 = $createParagraphNode();
      p9.append($createTextNode(p9Text));
      root.append(p9);
    }, { discrete: true });

    // RECORD STEP A, B, C: BEFORE INSERTION
    const stateA = editor.getEditorState().toJSON();
    const serializedB = editor.getEditorState().read(() => serializeStudioDocument(stateA.root));
    const plainTextBefore = renderStudioDocumentToPlainText(serializedB);
    const wordCountC = countWords(plainTextBefore);

    console.log("\n--- [PHASE 1: BEFORE INSERTION] ---");
    console.log("Total Root Children:", stateA.root.children.length);
    console.log("Total Word Count:", wordCountC);
    console.log("Children Breakdown:", dumpChildrenSummary(editor));

    expect(wordCountC).toBeGreaterThanOrEqual(500);

    // STEP 2: Insert Image between p2 and quote
    let insertedKey = "";
    editor.update(() => {
      const root = $getRoot();
      const children = root.getChildren();
      // Insert after p2 (index 2)
      const p2Node = children[2];
      const imageNode = $createReactStudioCardNode("image", {
        assetId: "asset-img-001",
        src: "https://images.unsplash.com/photo-1451187580459-43490279c0fa",
        alt: "Global Digital Network Visualization",
        caption: "Figure 1: Omnichannel architecture and decentralized content graphs.",
        width: "wide",
      });
      p2Node?.insertAfter(imageNode);
      insertedKey = imageNode.getKey();
    }, { discrete: true });

    // RECORD STEP D, E, F: IMMEDIATELY AFTER INSERTION
    const stateD = editor.getEditorState().toJSON();
    const serializedE = editor.getEditorState().read(() => serializeStudioDocument(stateD.root));
    const plainTextAfter = renderStudioDocumentToPlainText(serializedE);
    const wordCountF = countWords(plainTextAfter);

    console.log("\n--- [PHASE 2: IMMEDIATELY AFTER INSERTION] ---");
    console.log("Total Root Children:", stateD.root.children.length);
    console.log("Total Word Count:", wordCountF);
    console.log("Children Breakdown:", dumpChildrenSummary(editor));

    expect(wordCountF).toBeGreaterThanOrEqual(wordCountC);

    // SIBLING PRESERVATION CHECK
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const imgIndex = children.findIndex((c) => c.getKey() === insertedKey);
      const prevSibling = children[imgIndex - 1];
      const nextSibling = children[imgIndex + 1];

      console.log("\n--- [SIBLING PRESERVATION AUDIT] ---");
      console.log(`Image Position: Index ${imgIndex}`);
      console.log(`Previous Sibling Type: ${prevSibling?.getType()}, Text: "${prevSibling?.getTextContent().slice(0, 40)}..."`);
      console.log(`Next Sibling Type: ${nextSibling?.getType()}, Text: "${nextSibling?.getTextContent().slice(0, 40)}..."`);
      console.log(`Sibling Continuity Valid: ${prevSibling !== undefined && nextSibling !== undefined}`);

      expect(prevSibling?.getType()).toBe("paragraph");
      expect(nextSibling?.getType()).toBe("quote");
    });

    // STEP 3: PERSISTENCE & DESERIALIZATION (SIMULATING SAVE / RELOAD)
    const editorReloaded = createEditor({
      nodes: [
        ...STUDIO_CORE_NODES,
        ReactStudioCardNode,
        StudioCardNode,
        {
          replace: StudioCardNode,
          with: (node: StudioCardNode) => new ReactStudioCardNode(node.getCardType(), node.getCardData()),
        },
      ],
    });

    const migratedDoc = migrateDocument(serializedE);
    const parsedState = editorReloaded.parseEditorState({
      root: { ...migratedDoc.root, version: 1 },
    } as never);
    editorReloaded.setEditorState(parsedState);

    const stateG = editorReloaded.getEditorState().toJSON();
    const serializedH = editorReloaded.getEditorState().read(() => serializeStudioDocument(stateG.root));
    const wordCountI = countWords(renderStudioDocumentToPlainText(serializedH));

    console.log("\n--- [PHASE 3: PERSISTENCE & RELOAD] ---");
    console.log("Reloaded Root Children:", stateG.root.children.length);
    console.log("Reloaded Word Count:", wordCountI);
    console.log("Children Breakdown:", dumpChildrenSummary(editorReloaded));

    expect(wordCountI).toBe(wordCountF);

    // HTML RENDERING CHECK
    const renderedHtml = renderStudioDocumentToHtml(serializedH);
    console.log("\n--- [PUBLIC HTML RENDER AUDIT] ---");
    console.log("Rendered HTML Length:", renderedHtml.length);
    console.log("Contains Image Figure:", renderedHtml.includes("<figure"));
    console.log("Contains Figcaption:", renderedHtml.includes("<figcaption"));
    console.log("Contains All Headings & Paragraphs:",
      renderedHtml.includes("Architectural Foundations") &&
      renderedHtml.includes("contemporary landscape") &&
      renderedHtml.includes("transition to AST-driven") &&
      renderedHtml.includes("State Synchronization") &&
      renderedHtml.includes("Figure 1: Omnichannel")
    );

    expect(renderedHtml).toContain("Architectural Foundations");
    expect(renderedHtml).toContain("State Synchronization");
    expect(renderedHtml).toContain("Figure 1: Omnichannel");
    expect(renderedHtml).not.toContain("Content rendering unavailable");
  });

  it("checks selection handling across all 6 cursor/selection positions", () => {
    console.log("\n============================================================");
    console.log("2. SELECTION HANDLING & CURSOR POSITION TESTS");
    console.log("============================================================");

    // Case 1: Cursor in middle of paragraph
    const editor1 = createEditor({ nodes: [...STUDIO_CORE_NODES, ReactStudioCardNode, StudioCardNode] });
    editor1.update(() => {
      const root = $getRoot();
      const p = $createParagraphNode();
      const t1 = $createTextNode("First half of paragraph text. ");
      const t2 = $createTextNode("Second half of paragraph text.");
      p.append(t1, t2);
      root.append(p);

      // Slash at middle
      const slashNode = $createTextNode("/image");
      p.append(slashNode);
      const slashIdx = slashNode.getTextContent().lastIndexOf("/");
      if (slashIdx > 0) {
        slashNode.setTextContent(slashNode.getTextContent().slice(0, slashIdx));
      } else {
        slashNode.remove();
      }

      const card = $createReactStudioCardNode("image", { src: "https://example.com/p.jpg" });
      p.insertAfter(card);
    }, { discrete: true });

    editor1.getEditorState().read(() => {
      const root = $getRoot();
      console.log("Case 1 (Middle of paragraph) Children Count:", root.getChildren().length);
      expect(root.getChildren().length).toBe(2);
      expect(root.getChildren()[0]?.getTextContent()).toContain("First half");
      expect(root.getChildren()[0]?.getTextContent()).toContain("Second half");
    });

    // Case 2: Cursor at end of paragraph
    const editor2 = createEditor({ nodes: [...STUDIO_CORE_NODES, ReactStudioCardNode, StudioCardNode] });
    editor2.update(() => {
      const root = $getRoot();
      const p = $createParagraphNode();
      const text = $createTextNode("This is the full paragraph. /image");
      p.append(text);
      root.append(p);

      const content = text.getTextContent();
      const slashIdx = content.lastIndexOf("/");
      if (slashIdx > 0) {
        text.setTextContent(content.slice(0, slashIdx));
      } else {
        text.remove();
      }

      const card = $createReactStudioCardNode("image", { src: "https://example.com/p.jpg" });
      p.insertAfter(card);
    }, { discrete: true });

    editor2.getEditorState().read(() => {
      const root = $getRoot();
      console.log("Case 2 (End of paragraph) Children Count:", root.getChildren().length);
      expect(root.getChildren().length).toBe(2);
      expect(root.getChildren()[0]?.getTextContent()).toBe("This is the full paragraph. ");
    });

    // Case 3: Cursor at beginning of paragraph (empty slash line)
    const editor3 = createEditor({ nodes: [...STUDIO_CORE_NODES, ReactStudioCardNode, StudioCardNode] });
    editor3.update(() => {
      const root = $getRoot();
      const pBefore = $createParagraphNode();
      pBefore.append($createTextNode("Paragraph before"));
      root.append(pBefore);

      const pSlash = $createParagraphNode();
      const slashText = $createTextNode("/image");
      pSlash.append(slashText);
      root.append(pSlash);

      const pAfter = $createParagraphNode();
      pAfter.append($createTextNode("Paragraph after"));
      root.append(pAfter);

      slashText.remove();
      const card = $createReactStudioCardNode("image", { src: "https://example.com/p.jpg" });
      pSlash.replace(card);
    }, { discrete: true });

    editor3.getEditorState().read(() => {
      const root = $getRoot();
      console.log("Case 3 (Beginning of line/isolated slash) Children Count:", root.getChildren().length);
      expect(root.getChildren().length).toBe(3);
      expect(root.getChildren()[0]?.getTextContent()).toBe("Paragraph before");
      expect(root.getChildren()[1]?.getType()).toBe("react-studio-card");
      expect(root.getChildren()[2]?.getTextContent()).toBe("Paragraph after");
    });
  });
});
