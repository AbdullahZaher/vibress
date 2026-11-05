/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  $getRoot,
  $getSelection,
  $createParagraphNode,
  $createTextNode,
  UNDO_COMMAND,
  REDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  createDefaultStudioDocument,
  type StudioDocument,
} from "@vibress/studio-core";
import { VibressStudio, type VibressStudioProps } from "../VibressStudio";

const capture = vi.hoisted(() => ({ editor: null as LexicalEditor | null }));
vi.mock("../plugins/WordCountPlugin", async () => {
  const { useLexicalComposerContext } =
    await import("@lexical/react/LexicalComposerContext");
  return {
    WordCountPlugin: () => {
      [capture.editor] = useLexicalComposerContext();
      return null;
    },
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<{ root: Root; element: HTMLElement }> = [];
afterEach(async () => {
  for (const v of mounted.splice(0)) {
    await act(async () => v.root.unmount());
    v.element.remove();
  }
  capture.editor = null;
});
const documentOf = (status = "old") => ({
  ...createDefaultStudioDocument("Original مسودة"),
  publicationMetadata: { status },
  editor: { lexicalVersion: "0.13.1", extension: "retained" },
});
async function mount() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mounted.push({ root, element });
  const onChange = vi.fn<(doc: StudioDocument) => void>();
  const onError = vi.fn();
  const render = async (
    value: unknown,
    props: Partial<VibressStudioProps> = {},
  ) => {
    await act(async () =>
      root.render(
        <VibressStudio
          value={value}
          onChange={onChange}
          onError={onError}
          {...props}
        />,
      ),
    );
  };
  await render(documentOf());
  if (!capture.editor) throw new Error("Actual host editor did not mount");
  const editor = capture.editor;
  const edit = async (text: string) => {
    await act(async () => {
      editor.update(
        () => {
          const p = $createParagraphNode().append($createTextNode(text));
          $getRoot().clear().append(p);
          p.selectEnd();
        },
        { discrete: true, tag: "history-push" },
      );
    });
  };
  const text = () =>
    editor.getEditorState().read(() => $getRoot().getTextContent());
  return {
    element,
    render,
    editor,
    edit,
    text,
    onChange,
    onError,
    latest: () => onChange.mock.calls.at(-1)![0],
  };
}
describe("actual host document synchronization", () => {
  it("never replaces a short newer draft with an autosave echo", async () => {
    const v = await mount();
    await v.edit("Draft A");
    const stale = v.latest();
    await v.edit("Draft B");
    await v.render(stale);
    expect(v.text()).toBe("Draft B");
  });
  it("accepts ordered metadata around an unchanged/stale root without emissions or dirty resets", async () => {
    const v = await mount();
    const count = v.onChange.mock.calls.length;
    await v.render(documentOf("new"), { metadataRevision: 2 });
    expect(v.onChange).toHaveBeenCalledTimes(count);
    await v.edit("Draft A");
    const stale = v.latest();
    expect(stale.publicationMetadata).toEqual({ status: "new" });
    expect(stale.editor).toMatchObject({ extension: "retained" });
    await v.edit("Draft B");
    await v.render(
      { ...stale, publicationMetadata: { status: "stale" } },
      { metadataRevision: 1, revisionId: 100 },
    );
    expect(v.text()).toBe("Draft B");
    await v.edit("Draft C");
    expect(v.latest().publicationMetadata).toEqual({ status: "new" });
  });
  it("keeps the mounted draft, selection and history when incoming content is rejected, then recovers", async () => {
    const v = await mount();
    await v.edit("First draft");
    await v.edit("Second draft");
    const editable = v.element.querySelector('[contenteditable="true"]');
    const selection = v.editor
      .getEditorState()
      .read(() => $getSelection()?.clone());
    await v.render({ ...documentOf(), version: 2 });
    expect(v.element.querySelector("[contenteditable]")).toBe(editable);
    expect(v.editor.isEditable()).toBe(false);
    expect(v.text()).toBe("Second draft");
    await v.render(documentOf());
    expect(v.editor.isEditable()).toBe(true);
    expect(v.text()).toBe("Second draft");
    v.editor
      .getEditorState()
      .read(() => expect(selection?.is($getSelection())).toBe(true));
    await act(async () => {
      v.editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
    expect(v.text()).toBe("First draft");
    await act(async () => {
      v.editor.dispatchCommand(REDO_COMMAND, undefined);
    });
    expect(v.text()).toBe("Second draft");
  });
  it("localizes recovery independently of document bidi and suppresses paused snapshots", async () => {
    const v = await mount();
    await v.edit("مسودة English");
    const before = v.onChange.mock.calls.length;
    await v.render({ invalid: true }, { recoveryLocale: "ar" });
    const notice = v.element.querySelector('[role="alert"]');
    expect(notice?.getAttribute("lang")).toBe("ar");
    expect(notice?.getAttribute("dir")).toBe("rtl");
    expect(notice?.textContent).toContain("مسودتك الحالية");
    await v.edit("Pending local update");
    expect(v.onChange).toHaveBeenCalledTimes(before);
    await v.render(documentOf(), { recoveryLocale: "en" });
    expect(v.text()).toBe("Pending local update");
  });

  it("protects local content even when the host omits onChange", async () => {
    const v = await mount();
    await v.render(documentOf(), { onChange: undefined });
    await v.edit("Local without autosave callback");
    await v.render(documentOf("echo"), { onChange: undefined });
    expect(v.text()).toBe("Local without autosave callback");
  });

  it("requires replacementId for explicit restore, including a smaller document", async () => {
    const v = await mount();
    await v.edit("Long draft ".repeat(100));
    await v.render(createDefaultStudioDocument("Restored"), {
      replacementId: "restore-1",
    });
    expect(v.text()).toBe("Restored");
  });
  it("preserves an active draft after invalid input and does not consume replacement authorization", async () => {
    const v = await mount();
    await v.edit("Draft");
    await v.render({ invalid: true }, { replacementId: "restore-1" });
    expect(v.text()).toBe("Draft");
    await v.render(createDefaultStudioDocument("Recovered"), {
      replacementId: "restore-1",
    });
    expect(v.text()).toBe("Recovered");
  });
});
