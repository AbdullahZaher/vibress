import { useState, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
} from "lexical";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Send,
  Check,
  RefreshCw,
  X,
  Wand2,
  AlertCircle,
} from "lucide-react";

export interface InlineAIPluginProps {
  anchorElem?: HTMLElement | undefined;
  /** Optional AI completion provider function. When omitted, indicates AI Gateway is offline. */
  onGenerate?: ((prompt: string) => Promise<string>) | undefined;
  disabled?: boolean | undefined;
}

export function InlineAIPlugin({
  anchorElem = document.body,
  onGenerate,
  disabled = false,
}: InlineAIPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Listen for Space key on empty line to trigger AI if enabled
  useEffect(() => {
    if (disabled) return;

    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (event.key === " " && !isOpen) {
          let shouldOpen = false;
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && selection.isCollapsed()) {
              const node = selection.anchor.getNode();
              const textContent = node.getTextContent();
              if (!textContent || textContent.trim() === "") {
                shouldOpen = true;
              }
            }
          });

          if (shouldOpen) {
            const domSelection = window.getSelection();
            if (domSelection && domSelection.rangeCount > 0) {
              const rect = domSelection.getRangeAt(0).getBoundingClientRect();
              setPosition({
                top: rect.bottom + window.scrollY + 8,
                left: Math.max(20, rect.left + window.scrollX),
              });
              setIsOpen(true);
              setErrorMessage(null);
              setTimeout(() => inputRef.current?.focus(), 50);
              return true; // prevent extra space
            }
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, isOpen, disabled]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        if (!loading) {
          setIsOpen(false);
          setGeneratedText(null);
          setPrompt("");
          setErrorMessage(null);
        }
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, loading]);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleGenerate = async (customPrompt?: string) => {
    const promptToUse = customPrompt || prompt;
    if (!promptToUse.trim()) return;

    setLoading(true);
    setGeneratedText(null);
    setErrorMessage(null);
    abortControllerRef.current = new AbortController();

    try {
      if (!onGenerate) {
        // Honest state: AI Gateway is not configured
        setErrorMessage(
          "Vibress AI Gateway is not configured or offline. Configure an AI provider to enable completions.",
        );
        setLoading(false);
        return;
      }

      const result = await onGenerate(promptToUse);
      if (!abortControllerRef.current?.signal.aborted) {
        setGeneratedText(result);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Request was cleanly cancelled
      }
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to generate AI response.",
      );
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleAccept = () => {
    if (!generatedText) return;
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const lines = generatedText.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const p = $createParagraphNode();
          p.append($createTextNode(lines[i]));
          selection.insertNodes([p]);
        }
      }
    });
    setIsOpen(false);
    setGeneratedText(null);
    setPrompt("");
    setErrorMessage(null);
  };

  const handleDiscard = () => {
    setIsOpen(false);
    setGeneratedText(null);
    setPrompt("");
    setErrorMessage(null);
  };

  if (!isOpen || !position || disabled) {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      className="vibress-ai-popup studio-glassy-menu studio-ai-popup"
      style={{
        position: "absolute",
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: "420px",
        zIndex: 200,
        padding: "12px",
        fontFamily: "inherit",
      }}
    >
      {/* Header / Input */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            background: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)",
            color: "#fff",
          }}
        >
          <Sparkles size={16} />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleGenerate();
            }
          }}
          placeholder="Ask Vibress AI to assist with writing..."
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            fontSize: "14px",
            color: "#0f172a",
          }}
        />
        <button
          type="button"
          disabled={loading || !prompt.trim()}
          onClick={() => handleGenerate()}
          style={{
            border: "none",
            background: prompt.trim() ? "#6366f1" : "#e2e8f0",
            color: "#fff",
            borderRadius: "6px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: prompt.trim() ? "pointer" : "default",
          }}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Loading state with Cancel button */}
      {loading && (
        <div
          style={{
            padding: "12px 8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#6366f1",
            fontSize: "13px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Wand2 size={16} className="animate-spin" />
            <span>Connecting to Vibress AI Gateway...</span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: "4px 8px",
              borderRadius: "4px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              fontSize: "11px",
              color: "#64748b",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error / Offline state */}
      {errorMessage && !loading && (
        <div
          style={{
            backgroundColor: "#fff1f2",
            border: "1px solid #fecdd3",
            borderRadius: "8px",
            padding: "10px 12px",
            marginBottom: "10px",
            fontSize: "13px",
            lineHeight: 1.5,
            color: "#9f1239",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <AlertCircle size={16} style={{ marginTop: "2px", flexShrink: 0 }} />
          <div>{errorMessage}</div>
        </div>
      )}

      {/* Result Display with Diff Preview */}
      {generatedText && !loading && (
        <div
          style={{
            backgroundColor: diffMode ? "#f0fdf4" : "#f8fafc",
            border: diffMode ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "10px 12px",
            marginBottom: "10px",
            fontSize: "13px",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            color: diffMode ? "#166534" : "#1e293b",
          }}
        >
          {diffMode ? `+ ${generatedText}` : generatedText}
        </div>
      )}

      {/* Actions when text is generated */}
      {generatedText && !loading && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "4px",
          }}
        >
          <button
            type="button"
            onClick={() => setDiffMode(!diffMode)}
            style={{
              padding: "4px 8px",
              borderRadius: "4px",
              border: "1px solid #e2e8f0",
              background: diffMode ? "#e0e7ff" : "#fff",
              fontSize: "11px",
              color: "#4338ca",
              cursor: "pointer",
            }}
          >
            {diffMode ? "Normal Preview" : "Diff View"}
          </button>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={handleDiscard}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                backgroundColor: "#fff",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                color: "#64748b",
              }}
            >
              <X size={13} /> Discard
            </button>
            <button
              type="button"
              onClick={() => handleGenerate()}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                backgroundColor: "#fff",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                color: "#0f172a",
              }}
            >
              <RefreshCw size={13} /> Try Again
            </button>
            <button
              type="button"
              onClick={handleAccept}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: "#0f172a",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Check size={13} /> Insert Below
            </button>
          </div>
        </div>
      )}
    </div>,
    anchorElem,
  );
}

