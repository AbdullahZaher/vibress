import {
  useEffect,
  useRef,
  useMemo,
  Component,
  ErrorInfo,
  ReactNode,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { TRANSFORMERS } from "@lexical/markdown";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { CollaborationPlugin } from "@lexical/react/LexicalCollaborationPlugin";
import { SlashMenuPlugin } from "./plugins/SlashMenuPlugin";
import { FloatingFormatToolbarPlugin } from "./plugins/FloatingFormatToolbarPlugin";
import { FloatingCardActionToolbarPlugin } from "./plugins/FloatingCardActionToolbarPlugin";
import { BlockHandleGutterPlugin } from "./plugins/BlockHandleGutterPlugin";
import { InlineAIPlugin } from "./plugins/InlineAIPlugin";
import { STUDIO_CORE_NODES } from "@vibress/studio-nodes";
import { StudioCardNode } from "@vibress/studio-cards";
import { ReactStudioCardNode } from "./nodes/ReactStudioCardNode";
import { StudioDocument, migrateDocument } from "@vibress/studio-core";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import { logForensicEvent, extractDocStats } from "@vibress/studio-utils";
import { StudioUploadContext, StudioUploadApi } from "./upload-context";
import { StudioMediaContext, StudioMediaRequest } from "./media-context";
import { CollaborationConfig } from "./collaboration/types";

export interface VibressStudioProps {
  value?: unknown;
  onChange?: ((doc: StudioDocument) => void) | undefined;
  readOnly?: boolean | undefined;
  enableAi?: boolean | undefined;
  onAiGenerate?: ((prompt: string) => Promise<string>) | undefined;
  placeholder?: string | undefined;
  onError?: ((error: Error) => void) | undefined;
  requestMedia?:
    | ((req: StudioMediaRequest) => Promise<Record<string, unknown> | null>)
    | undefined;
  /** Whether external stock photo provider (Unsplash) is available in host */
  allowUnsplash?: boolean | undefined;
  /** Durable upload adapter: local file → assetId/src payload. Card editors
   *  must use this instead of transient blob: URLs. */
  uploadMedia?: StudioUploadApi["uploadMedia"] | undefined;
  collaboration?: CollaborationConfig | undefined;
  className?: string | undefined;
}

interface StudioErrorBoundaryProps {
  children: ReactNode;
  onError?: ((err: Error) => void) | undefined;
}

class StudioErrorBoundary extends Component<
  StudioErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "12px",
            border: "1px solid red",
            borderRadius: "4px",
            background: "#fff0f0",
            color: "#c00",
          }}
        >
          <strong>Studio Error:</strong> The editor encountered an issue
          displaying content.
        </div>
      );
    }
    return this.props.children;
  }
}

function InitialStatePlugin({ document }: { document: StudioDocument }) {
  const [editor] = useLexicalComposerContext();
  const lastDocRef = useRef<StudioDocument | null>(null);

  useEffect(() => {
    if (!document || !document.root) return;
    const stats = extractDocStats(document);
    logForensicEvent("INITIAL_STATE_RECEIVED", {
      childCount: stats.childCount,
      wordCount: stats.wordCount,
      hash: stats.hash,
      isSameRef: lastDocRef.current === document,
    });
    if (lastDocRef.current === document) return;
    lastDocRef.current = document;

    const currentRoot = editor.getEditorState().toJSON().root;
    const currentDoc = serializeStudioDocument(currentRoot);
    const currentStats = extractDocStats(currentDoc);

    // 1. Content Hash Equality: if current editor state serializes to identical content hash, skip
    if (currentStats.hash === stats.hash) {
      return;
    }

    // 2. Destructive downscaling protection:
    // Never allow an incoming external document with drastically reduced content to overwrite
    // a richer active editor state (unless explicitly empty initial load).
    if (currentStats.wordCount >= 50 && stats.wordCount < currentStats.wordCount * 0.3) {
      console.warn(
        `[InitialStatePlugin] Blocked destructive state replacement: current has ${currentStats.wordCount} words, incoming has ${stats.wordCount} words.`,
      );
      return;
    }

    try {
      const editorState = editor.parseEditorState({
        root: { ...document.root, version: 1 },
      } as never);
      editor.setEditorState(editorState);
      logForensicEvent("INITIAL_STATE_APPLIED", {
        childCount: stats.childCount,
        wordCount: stats.wordCount,
        hash: stats.hash,
      });
    } catch (err) {
      console.error("Failed to sync external editor state", err);
    }
  }, [document, editor]);

  return null;
}


export function VibressStudio({
  value,
  onChange,
  readOnly = false,
  enableAi = false,
  onAiGenerate,
  placeholder = 'Write content with Vibress Studio (type "/" for commands)...',
  onError,
  requestMedia,
  allowUnsplash,
  uploadMedia,
  collaboration,
  className = "",
}: VibressStudioProps) {
  const parsedDoc = useMemo(() => migrateDocument(value), [value]);
  const initialDocRef = useRef<StudioDocument>(parsedDoc);

  const initialEditorState = useMemo<string | null>(() => {
    const initialDoc = initialDocRef.current;
    logForensicEvent("INITIAL_CONFIG_EDITOR_STATE", {
      hasInitialDoc: !!initialDoc,
      childCount: initialDoc?.root?.children?.length ?? 0,
      stats: initialDoc ? extractDocStats(initialDoc) : null,
    });
    if (
      initialDoc &&
      initialDoc.root &&
      Array.isArray(initialDoc.root.children) &&
      initialDoc.root.children.length > 0
    ) {
      return JSON.stringify({
        root: { ...initialDoc.root, version: 1 },
      });
    }
    return null;
  }, []);

  const initialConfig = useMemo(
    () => ({
      namespace: "VibressStudio",
      editorState: collaboration ? null : initialEditorState,
      nodes: [
        ...STUDIO_CORE_NODES,
        ReactStudioCardNode,
        StudioCardNode,
        {
          replace: StudioCardNode,
          // IMPORTANT: do not pass the original node's key. $setNodeKey
          // already registered the original under that key; a replacement
          // with the same key never enters the node map. A fresh key makes
          // the replacement the real rendered node.
          with: (node: StudioCardNode) => {
            return new ReactStudioCardNode(
              node.getCardType(),
              node.getCardData(),
            );
          },
        },
      ],
      editable: !readOnly,
      onError: (error: Error) => {
        if (onError) onError(error);
      },
      theme: {
        paragraph: "studio-paragraph",
        heading: {
          h1: "studio-h1",
          h2: "studio-h2",
          h3: "studio-h3",
        },
        list: {
          ul: "studio-ul",
          ol: "studio-ol",
          listitem: "studio-listitem",
          nested: {
            listitem: "studio-nested-listitem",
          },
          listitemChecked: "studio-checklist-checked",
          listitemUnchecked: "studio-checklist-unchecked",
        },
        table: "studio-table",
        tableCell: "studio-table-cell",
        tableCellHeader: "studio-table-cell-header",
        tableRow: "studio-table-row",
        quote: "studio-quote",
        code: "studio-code-block",
        text: {
          bold: "studio-bold",
          italic: "studio-italic",
          underline: "studio-underline",
          strikethrough: "studio-strikethrough",
          code: "studio-code",
        },
      },
    }),
    [readOnly, onError],
  );

  return (
    <StudioErrorBoundary onError={onError}>
      <StudioUploadContext.Provider value={{ uploadMedia }}>
        <StudioMediaContext.Provider
          value={{ uploadMedia, requestMedia, allowUnsplash }}
        >
          <div className={`vibress-studio-editor ${className}`}>
            <LexicalComposer initialConfig={initialConfig}>
            <div
              className="vibress-studio-canvas"
              style={{
                position: "relative",
                minHeight: "40vh",
              }}
            >
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    className="vibress-studio-content focus:outline-none"
                    style={{
                      outline: "none",
                      minHeight: "40vh",
                      color: "inherit",
                    }}
                  />
                }
                placeholder={
                  <div
                    className="vibress-studio-placeholder select-none"
                    style={{
                      position: "absolute",
                      top: "0",
                      insetInline: "0",
                      maxWidth: "740px",
                      marginInline: "auto",
                      color: "var(--muted-foreground)",
                      opacity: 0.55,
                      pointerEvents: "none",
                      fontSize: "1.125rem",
                      lineHeight: "1.8",
                    }}
                  >
                    {placeholder}
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              {collaboration ? (
                <CollaborationPlugin
                  id={collaboration.id}
                  providerFactory={collaboration.providerFactory}
                  shouldBootstrap={true}
                  username={collaboration.user.name}
                  cursorColor={collaboration.cursorColor || collaboration.user.color}
                  initialEditorState={initialEditorState}
                />
              ) : (
                <HistoryPlugin />
              )}
              <ListPlugin />
              <CheckListPlugin />
              <TablePlugin hasCellMerge hasCellBackgroundColor hasTabHandler />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              <LinkPlugin />
              <SlashMenuPlugin requestMedia={requestMedia} />
              <FloatingFormatToolbarPlugin />
              <FloatingCardActionToolbarPlugin />
              {!readOnly && <BlockHandleGutterPlugin />}
              {!readOnly && enableAi && (
                <InlineAIPlugin
                  disabled={!enableAi}
                  onGenerate={onAiGenerate}
                />
              )}
              {!collaboration && <InitialStatePlugin document={parsedDoc} />}
              {onChange && (
                <OnChangePlugin
                  onChange={(editorState) => {
                    const rootNode = editorState.toJSON().root;
                    const studioDoc = serializeStudioDocument(rootNode);
                    const stats = extractDocStats(studioDoc);
                    logForensicEvent("AFTER_SERIALIZE", {
                      childCount: stats.childCount,
                      wordCount: stats.wordCount,
                      hash: stats.hash,
                    });
                    onChange(studioDoc);
                  }}
                />
              )}

            </div>
          </LexicalComposer>
        </div>
        </StudioMediaContext.Provider>
      </StudioUploadContext.Provider>
    </StudioErrorBoundary>
  );
}
