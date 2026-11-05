/** @vitest-environment jsdom */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { $getNodeByKey, $getRoot, type LexicalEditor } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { UNDO_COMMAND, REDO_COMMAND } from "lexical";
import { StudioCardNode, type GalleryCardData } from "@vibress/studio-cards";
import { ReactStudioCardNode, $createReactStudioCardNode } from "../../../nodes/ReactStudioCardNode";
import { StudioMediaContext } from "../../../media-context";
import { GalleryCardEditor } from "../GalleryCardEditor";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import { migrateDocument } from "@vibress/studio-core";

vi.mock("../NestedCaptionEditor", () => ({
  NestedCaptionEditor: () => null,
}));
vi.mock("../../ui/StudioMediaFloatingToolbar", () => ({
  StudioMediaFloatingToolbar: ({ onChange, changeLabel }: {
    onChange?: () => void;
    changeLabel: string;
  }) => <button aria-label={changeLabel} onClick={onChange}>Open media library</button>,
}));
vi.mock("../../ui/media-popovers/GalleryMetadataPopover", () => ({
  GalleryMetadataPopover: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const source: GalleryCardData = {
  images: [
    { src: "/media/one.jpg", alt: "One", assetId: "asset-1", caption: "" },
    { src: "/media/two.jpg", alt: "Two", assetId: "asset-2", caption: "" },
  ],
  caption: "صورة gallery",
  captionHtml: "<p>صورة gallery</p>",
  width: "wide",
};

function Setup({ ready }: { ready: (editor: LexicalEditor, key: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let key = "";
    editor.update(() => {
      const card = $createReactStudioCardNode("gallery", source);
      $getRoot().append(card);
      key = card.getKey();
    }, { discrete: true });
    ready(editor, key);
  }, [editor, ready]);
  return null;
}

describe("actual host GalleryCardEditor additive picker", () => {
  const mounted: Array<{ root: Root; element: HTMLDivElement }> = [];
  afterEach(async () => {
    for (const { root, element } of mounted.splice(0)) {
      await act(async () => { root.unmount(); });
      element.remove();
    }
  });

  async function mount(requestMedia: () => Promise<Record<string, unknown> | null>) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    mounted.push({ element, root });
    let editor: LexicalEditor | null = null;
    let cardKey = "";
    const ready = (instance: LexicalEditor, key: string) => { editor = instance; cardKey = key; };
    await act(async () => {
      root.render(
        <StudioMediaContext.Provider value={{ requestMedia }}>
          <LexicalComposer initialConfig={{ namespace: "GalleryIntegration", nodes: [StudioCardNode, ReactStudioCardNode],
            onError(error: Error) { throw error; } }}>
            <Setup ready={ready} />
            <HistoryPlugin />
          </LexicalComposer>
        </StudioMediaContext.Provider>,
      );
    });
    expect(editor).not.toBeNull();
    expect(cardKey).not.toBe("");
    await act(async () => {
      root.render(
        <StudioMediaContext.Provider value={{ requestMedia }}>
          <LexicalComposer initialConfig={{ namespace: "GalleryIntegration", nodes: [StudioCardNode, ReactStudioCardNode],
            onError(error: Error) { throw error; } }}>
            <Setup ready={ready} />
            <HistoryPlugin />
            <GalleryCardEditor nodeKey={cardKey} cardData={source} />
          </LexicalComposer>
        </StudioMediaContext.Provider>,
      );
    });
    const activeEditor = editor as LexicalEditor | null;
    if (!activeEditor) throw new Error("Lexical editor missing");
    const readData = () => {
      const doc = serializeStudioDocument(activeEditor.getEditorState().toJSON().root);
      const node = doc.root.children[0] as { cardData?: GalleryCardData };
      return { doc, data: node.cardData };
    };
    const openPicker = async () => {
      const button = element.querySelector<HTMLButtonElement>('button[aria-label="Add Images"]');
      expect(button).not.toBeNull();
      await act(async () => { button?.click(); });
    };
    return { element, editor: activeEditor, cardKey, readData, openPicker };
  }

  it("preserves earlier images, current concurrent caption and width edits, and reloads all three", async () => {
    const pending = deferred<Record<string, unknown> | null>();
    const { editor, cardKey, readData, openPicker } = await mount(() => pending.promise);
    await openPicker();
    await act(async () => {
      editor.update(() => {
        const node = $getNodeByKey(cardKey);
        if (!(node instanceof StudioCardNode)) throw new Error("gallery removed");
        node.setCardData({ ...node.getCardData(), caption: "تحرير أثناء الاختيار",
          width: "full", customField: "retain" });
      }, { discrete: true });
    });
    await act(async () => {
      pending.resolve({ images: [
        { assetId: "asset-2", src: "/media/two.jpg", alt: "Duplicate" },
        { assetId: "asset-3", src: "/media/three.jpg", alt: "New" },
        { assetId: "bad", src: "blob:https://example.org/temporary" },
        { assetId: "bad-2", src: "javascript:alert(1)" },
      ] });
      await pending.promise;
    });
    const { doc, data } = readData();
    expect(data?.images.map((i) => i.assetId)).toEqual(["asset-1", "asset-2", "asset-3"]);
    expect(data?.caption).toBe("تحرير أثناء الاختيار");
    expect(data?.width).toBe("full");
    expect((data as Record<string, unknown>)?.customField).toBe("retain");
    expect(data?.captionHtml).toBe("<p>صورة gallery</p>");
    const reloaded = migrateDocument(JSON.stringify(doc));
    expect(JSON.stringify(reloaded)).toContain("/media/three.jpg");
    expect(JSON.stringify(reloaded)).toContain("تحرير أثناء الاختيار");
  });

  it("does not resurrect a removed gallery after a delayed picker response", async () => {
    const pending = deferred<Record<string, unknown> | null>();
    const { editor, cardKey, openPicker } = await mount(() => pending.promise);
    await openPicker();
    await act(async () => {
      editor.update(() => { $getNodeByKey(cardKey)?.remove(); }, { discrete: true });
    });
    await act(async () => {
      pending.resolve({ images: [{ src: "/media/late.jpg", assetId: "late" }] });
      await pending.promise;
    });
    const json = JSON.stringify(editor.getEditorState().toJSON());
    expect(json).not.toContain("/media/late.jpg");
  });

  it("treats cancel as a strict no-op", async () => {
    const { openPicker, readData } = await mount(async () => null);
    const before = JSON.stringify(readData().doc);
    await openPicker();
    expect(JSON.stringify(readData().doc)).toBe(before);
  });

  it("preserves undo and redo history for image appends", async () => {
    const { editor, readData, openPicker } = await mount(async () => ({
      images: [{ src: "/media/third.jpg", alt: "Third", assetId: "third" }],
    }));
    await openPicker();
    expect(readData().data?.images).toHaveLength(3);
    await act(async () => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    expect(readData().data?.images).toHaveLength(2);
    await act(async () => { editor.dispatchCommand(REDO_COMMAND, undefined); });
    expect(readData().data?.images).toHaveLength(3);
  });
});
