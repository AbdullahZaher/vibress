import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VibressStudio } from "../VibressStudio";
import { createDefaultStudioDocument } from "@vibress/studio-core";

describe("Host VibressStudio forward-content recovery boundary", () => {
  it("never mounts editable Lexical or emits a destructive empty snapshot for unknown schema", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      <VibressStudio value={{ schema: "newer", version: 2,
        root: { type: "root", children: [{ type: "future-node", text: "Author data" }] } }}
        onChange={onChange} />,
    );
    expect(html).toContain("Document recovery");
    expect(html).toContain("did not overwrite");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks unknown forward editor node types instead of discarding them", () => {
    const doc = createDefaultStudioDocument("Original draft");
    doc.root.children.push({ type: "future-rich-card", version: 1,
      cardData: { custom: "must survive" } });
    const html = renderToStaticMarkup(<VibressStudio value={doc} onChange={vi.fn()} />);
    expect(html).toContain("Unsupported editor node");
    expect(html).toContain("original document");
  });
});
