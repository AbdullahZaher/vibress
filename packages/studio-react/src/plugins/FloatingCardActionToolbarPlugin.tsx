import React, { useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isNodeSelection } from "lexical";
import { createPortal } from "react-dom";
import {
  $isReactStudioCardNode,
  ReactStudioCardNode,
} from "../nodes/ReactStudioCardNode";
import { Trash2, Maximize2, Minimize2, Move } from "lucide-react";

const MEDIA_CARD_TYPES = new Set([
  "image",
  "video",
  "audio",
  "gallery",
  "file",
  "embed",
]);

export function FloatingCardActionToolbarPlugin({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}) {
  const [editor] = useLexicalComposerContext();
  const [selectedNode, setSelectedNode] = useState<ReactStudioCardNode | null>(
    null,
  );
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isNodeSelection(selection)) {
          const nodes = selection.getNodes();
          if (nodes.length === 1 && $isReactStudioCardNode(nodes[0])) {
            const card = nodes[0] as ReactStudioCardNode;
            if (MEDIA_CARD_TYPES.has(card.getCardType())) {
              setSelectedNode(null);
              setCardRect(null);
              return;
            }
            setSelectedNode(card);
            const dom = editor.getElementByKey(card.getKey());
            if (dom) {
              setCardRect(dom.getBoundingClientRect());
            }
            return;
          }
        }
        setSelectedNode(null);
        setCardRect(null);
      });
    });
  }, [editor]);

  if (!selectedNode) return null;

  const currentWidth =
    (selectedNode.getCardData().width as string) || "regular";

  const handleWidthChange = (width: "regular" | "wide" | "full") => {
    editor.update(() => {
      const data = selectedNode.getCardData();
      selectedNode.setCardData({ ...data, width });
    });
  };

  const handleDelete = () => {
    editor.update(() => {
      selectedNode.remove();
    });
    setSelectedNode(null);
  };

  const topPos = cardRect ? cardRect.top + window.scrollY - 36 : 20;
  const leftPos = cardRect ? cardRect.left + window.scrollX : 20;

  return createPortal(
    <div
      className="floating-card-action-popup studio-glassy-menu select-none animate-in fade-in zoom-in-95 duration-150"
      style={{
        position: "absolute",
        top: `${Math.max(10, topPos)}px`,
        left: `${Math.max(10, leftPos)}px`,
        borderRadius: "10px",
        padding: "4px 8px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        zIndex: 160,
        fontSize: "12px",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#94a3b8",
          textTransform: "uppercase",
          paddingRight: "4px",
          letterSpacing: "0.05em",
        }}
      >
        {selectedNode.getCardType()}
      </span>

      <div
        style={{
          width: "1px",
          height: "14px",
          backgroundColor: "var(--border)",
          margin: "0 2px",
        }}
      />

      <button
        type="button"
        onClick={() => handleWidthChange("regular")}
        style={getBtnStyle(currentWidth === "regular")}
        title="Regular width"
      >
        <Minimize2 size={12} /> Regular
      </button>
      <button
        type="button"
        onClick={() => handleWidthChange("wide")}
        style={getBtnStyle(currentWidth === "wide")}
        title="Wide width"
      >
        <Move size={12} /> Wide
      </button>
      <button
        type="button"
        onClick={() => handleWidthChange("full")}
        style={getBtnStyle(currentWidth === "full")}
        title="Full screen width"
      >
        <Maximize2 size={12} /> Full
      </button>

      <div
        style={{
          width: "1px",
          height: "14px",
          backgroundColor: "var(--border)",
          margin: "0 2px",
        }}
      />

      <button
        type="button"
        onClick={handleDelete}
        style={{
          background: "transparent",
          border: "none",
          color: "#f87171",
          padding: "4px 7px",
          borderRadius: "6px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "11px",
          fontWeight: 500,
          transition: "all 0.15s ease",
        }}
      >
        <Trash2 size={12} /> Delete
      </button>
    </div>,
    anchorElem,
  );
}

function getBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--muted)" : "transparent",
    color: active ? "var(--primary)" : "inherit",
    border: "none",
    padding: "4px 8px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: active ? 600 : 400,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    transition: "all 0.12s ease",
  };
}
