import { describe, it, expect } from "vitest";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { turnSelectedBlockInto, turnNodeInto, TurnIntoType } from "../plugins/TurnIntoHelper";

describe("STUDIO-01: TurnIntoHelper Atomic Node Conversion Suite", () => {
  function setupTestEditor() {
    const editor = createEditor({
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode],
      onError: (error) => {
        throw error;
      },
    });

    return editor;
  }

  it("converts paragraph to heading atomically without exceptions", () => {
    const editor = setupTestEditor();
    let paragraphKey = "";

    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const text = $createTextNode("Hello world");
        p.append(text);
        root.append(p);
        paragraphKey = p.getKey();
      },
      { discrete: true },
    );

    expect(() => {
      turnNodeInto(editor, paragraphKey, "h1");
    }).not.toThrow();

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const firstChild = root.getFirstChild();
      expect(firstChild?.getType()).toBe("heading");
    });
  });

  it("handles rapid repeated conversions (paragraph -> h2 -> quote -> code -> paragraph) without desync", () => {
    const editor = setupTestEditor();
    let nodeKey = "";

    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode("Dynamic block"));
        root.append(p);
        nodeKey = p.getKey();
      },
      { discrete: true },
    );

    const sequence: TurnIntoType[] = ["h2", "quote", "code", "paragraph", "h3"];

    for (const targetType of sequence) {
      expect(() => {
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const firstChild = root.getFirstChild();
          if (firstChild) nodeKey = firstChild.getKey();
        });
        turnNodeInto(editor, nodeKey, targetType);
      }).not.toThrow();
    }

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const firstChild = root.getFirstChild();
      expect(firstChild?.getType()).toBe("heading");
    });
  });

  it("safely handles non-existent or unmounted node keys without crashing", () => {
    const editor = setupTestEditor();

    expect(() => {
      turnNodeInto(editor, "non-existent-key-9999", "quote");
    }).not.toThrow();
  });

  it("converts paragraph to bullet-list with valid ListNode -> ListItemNode hierarchy (P1-8)", () => {
    const editor = setupTestEditor();
    let pKey = "";

    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode("List item content"));
        root.append(p);
        pKey = p.getKey();
      },
      { discrete: true },
    );

    turnNodeInto(editor, pKey, "bullet-list");

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const list = root.getFirstChild();
      expect(list?.getType()).toBe("list");
      expect((list as ListNode).getListType()).toBe("bullet");
      const item = (list as ListNode).getFirstChild();
      expect(item?.getType()).toBe("listitem");
      expect(item?.getTextContent()).toBe("List item content");
    });
  });

  it("switches list type in-place and unwraps list back to paragraph (P1-8)", () => {
    const editor = setupTestEditor();
    let pKey = "";

    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode("Switchable content"));
        root.append(p);
        pKey = p.getKey();
      },
      { discrete: true },
    );

    turnNodeInto(editor, pKey, "bullet-list");
    let itemKey = "";
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const list = root.getFirstChild() as ListNode;
      itemKey = list.getFirstChild()!.getKey();
    });

    // Switch to number list in-place
    turnNodeInto(editor, itemKey, "number-list");
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const list = root.getFirstChild() as ListNode;
      expect(list.getType()).toBe("list");
      expect(list.getListType()).toBe("number");
    });

    // Switch back to paragraph
    turnNodeInto(editor, itemKey, "paragraph");
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const p = root.getFirstChild();
      expect(p?.getType()).toBe("paragraph");
      expect(p?.getTextContent()).toBe("Switchable content");
    });
  });
});
