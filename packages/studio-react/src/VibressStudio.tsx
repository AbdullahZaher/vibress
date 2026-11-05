import {
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useState,
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
import { WordCountPlugin } from "./plugins/WordCountPlugin";
import { STUDIO_CORE_NODES } from "@vibress/studio-nodes";
import { StudioCardNode } from "@vibress/studio-cards";
import { ReactStudioCardNode } from "./nodes/ReactStudioCardNode";
import {
  StudioDocument,
  migrateDocument,
  createEmptyStudioDocument,
  StudioMigrationError,
  type DocumentResourceLimits,
} from "@vibress/studio-core";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import { logForensicEvent, extractDocStats } from "@vibress/studio-utils";
import { StudioUploadContext, StudioUploadApi } from "./upload-context";
import { StudioMediaContext, StudioMediaRequest } from "./media-context";
import { CollaborationConfig } from "./collaboration/types";

export interface VibressStudioProps {
  value?: unknown;
  /** Shared inbound/outgoing resource admission (5 MiB / 50k AST / depth 64 by default). */
  resourceLimits?: DocumentResourceLimits | undefined;
  /** Informational persistence label; never authorizes draft replacement. */
  revisionId?: string | number | undefined;
  /** Explicit replacement command for non-collaborative documents. In Yjs mode,
   * replace the collaboration session/provider through the host instead. */
  replacementId?: string | number | undefined;
  /** Monotonic non-negative safe integer per replacement epoch. Authorizes
   * envelope-only updates; assign at the metadata source, never arrival order. */
  metadataRevision?: number | undefined;
  /** UI locale for recovery messages; independent of document direction. */
  recoveryLocale?: "en" | "ar" | undefined;
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
  showWordCount?: boolean | undefined;
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

const EXTERNAL_SYNC_TAG = "studio-host-external-sync";

function InitialStatePlugin({
  document,
  replacementId,
  metadataRevision,
  syncRoot,
  hasLocalEdits,
  onApplied,
  onError,
}: {
  document: StudioDocument | null;
  replacementId: string | number | undefined;
  metadataRevision: number | undefined;
  syncRoot: boolean;
  hasLocalEdits: () => boolean;
  onApplied: (document: StudioDocument, resetDraft: boolean) => void;
  onError: ((error: Error) => void) | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const lastIncoming = useRef<string | null>(null);
  const lastReplacement = useRef(replacementId);
  const metadataSequence = useRef(-1);
  const orderedMetadata = useRef(false);
  useEffect(() => {
    if (!document) return; // Invalid input must not consume authorization.
    const first = lastIncoming.current === null;
    const replacement =
      replacementId !== undefined && replacementId !== lastReplacement.current;
    const ordered =
      metadataRevision !== undefined &&
      Number.isSafeInteger(metadataRevision) &&
      metadataRevision >= 0;
    if (
      !first &&
      !replacement &&
      (metadataRevision !== undefined || orderedMetadata.current)
    ) {
      if (ordered && metadataRevision > metadataSequence.current) {
        onApplied(document, false);
        metadataSequence.current = metadataRevision;
        orderedMetadata.current = true;
      }
      return;
    }
    const incoming = JSON.stringify(document.root);
    if (!first && !replacement && incoming === lastIncoming.current) return;
    try {
      const current = JSON.stringify(
        serializeStudioDocument(editor.getEditorState().toJSON().root).root,
      );
      if (syncRoot && current !== incoming) {
        if (!replacement && hasLocalEdits()) return;
        const root = document.root.children.length
          ? document.root
          : {
              ...document.root,
              children: createEmptyStudioDocument().root.children,
            };
        editor.setEditorState(
          editor.parseEditorState(
            JSON.stringify({ root: { ...root, version: 1 } }),
          ),
          { tag: EXTERNAL_SYNC_TAG },
        );
      }
      lastIncoming.current = incoming;
      lastReplacement.current = replacementId;
      metadataSequence.current = ordered ? metadataRevision : -1;
      orderedMetadata.current = metadataRevision !== undefined;
      onApplied(document, syncRoot);
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error
          : new Error("Unable to load Studio document"),
      );
    }
  }, [
    editor,
    document,
    replacementId,
    metadataRevision,
    syncRoot,
    hasLocalEdits,
    onApplied,
    onError,
  ]);
  return null;
}

function EditorEditablePlugin({ paused }: { paused: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!paused);
  }, [editor, paused]);
  return null;
}

export function VibressStudio({
  value,
  resourceLimits,
  revisionId,
  replacementId,
  metadataRevision,
  recoveryLocale = "en",
  onChange,
  readOnly = false,
  enableAi = false,
  onAiGenerate,
  placeholder = "Begin writing your post...",
  onError,
  requestMedia,
  allowUnsplash,
  uploadMedia,
  collaboration,
  showWordCount = true,
  className = "",
}: VibressStudioProps) {
  const [snapshotError, setSnapshotError] = useState<Error | null>(null);
  const dirty = useRef(false);
  const lastEditorRoot = useRef<string | null>(null);
  const acceptedDocument = useRef<StudioDocument | undefined>(undefined);
  const [hasLoadedDocument, setHasLoadedDocument] = useState(false);
  const hasLocalEdits = useCallback(() => dirty.current, []);
  const onApplied = useCallback(
    (document: StudioDocument, resetDraft: boolean) => {
      acceptedDocument.current = document;
      if (resetDraft) {
        dirty.current = false;
        lastEditorRoot.current = JSON.stringify(document.root);
        setSnapshotError(null);
      }
    },
    [],
  );
  void revisionId;
  const { parsedDoc, migrationError } = useMemo(() => {
    try {
      const document = migrateDocument(value, resourceLimits);
      // Lexical cannot round-trip forward unknown nodes it has not registered;
      // never emit a smaller onChange snapshot from a partially loaded tree.
      const allowed = new Set([
        "root",
        "paragraph",
        "text",
        "linebreak",
        "tab",
        "heading",
        "quote",
        "list",
        "listitem",
        "link",
        "autolink",
        "code",
        "code-highlight",
        "table",
        "tablerow",
        "tablecell",
        "studio-card",
        "react-studio-card",
      ]);
      const inspect = (node: unknown): string | null => {
        if (!node || typeof node !== "object" || Array.isArray(node))
          return "invalid node";
        const entry = node as { type?: unknown; children?: unknown };
        if (typeof entry.type !== "string" || !allowed.has(entry.type))
          return String(entry.type);
        if (entry.children !== undefined) {
          if (!Array.isArray(entry.children)) return "invalid children";
          for (const child of entry.children) {
            const unknown = inspect(child);
            if (unknown) return unknown;
          }
        }
        return null;
      };
      const unsupported = inspect(document.root);
      if (unsupported) {
        throw new StudioMigrationError(
          `Unsupported editor node "${unsupported}" — original document preserved.`,
          value,
          "UNSUPPORTED_DOCUMENT",
        );
      }
      return { parsedDoc: document, migrationError: null as Error | null };
    } catch (error) {
      return {
        parsedDoc: null as StudioDocument | null,
        migrationError:
          error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [value, resourceLimits]);

  useEffect(() => {
    if (migrationError) onError?.(migrationError);
  }, [migrationError, onError]);

  useEffect(() => {
    if (parsedDoc) setHasLoadedDocument(true);
  }, [parsedDoc]);
  const editingPaused = readOnly || Boolean(migrationError);
  const initialDocRef = useRef<StudioDocument>(
    parsedDoc ?? createEmptyStudioDocument(),
  );

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

  const recoveryCopy =
    recoveryLocale === "ar"
      ? {
          title: "استعادة المستند: لم يُستبدل محتواك.",
          draft:
            "مسودتك الحالية محفوظة داخل المحرر. عالج مشكلة المستند الوارد لمتابعة التحرير.",
          source:
            "لا يمكن تحرير هذا المستند أو حفظه بأمان في هذا الإصدار. يجب الاحتفاظ بالأصل للتصدير أو الترحيل.",
          details: "التفاصيل التقنية",
        }
      : {
          title: "Document recovery: editor did not overwrite your content.",
          draft:
            "Your active draft remains in this editor. Resolve the incoming document error before continuing.",
          source:
            "The persisted document cannot safely be edited or saved in this version. The host must retain the original document for export or migration.",
          details: "Technical details",
        };
  const recoveryNotice = migrationError ? (
    <div
      role="alert"
      aria-live="assertive"
      lang={recoveryLocale}
      dir={recoveryLocale === "ar" ? "rtl" : "ltr"}
      className="vibress-studio-document-recovery"
    >
      <strong>{recoveryCopy.title}</strong>
      <p>{hasLoadedDocument ? recoveryCopy.draft : recoveryCopy.source}</p>
      <details>
        <summary>{recoveryCopy.details}</summary>
        <code>{migrationError.message}</code>
      </details>
    </div>
  ) : null;
  if (!parsedDoc && !hasLoadedDocument) return recoveryNotice;

  return (
    <StudioErrorBoundary onError={onError}>
      <StudioUploadContext.Provider value={{ uploadMedia }}>
        <StudioMediaContext.Provider
          value={{ uploadMedia, requestMedia, allowUnsplash }}
        >
          <div className={`vibress-studio-editor ${className}`}>
            {recoveryNotice}
            {snapshotError && (
              <div role="alert" aria-live="polite">
                <strong>Draft not saved:</strong> {snapshotError.message} Your
                current edits remain in the editor. Reduce content size and
                retry.
              </div>
            )}
            <fieldset
              disabled={editingPaused}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
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
                      cursorColor={
                        collaboration.cursorColor || collaboration.user.color
                      }
                      initialEditorState={initialEditorState}
                    />
                  ) : (
                    <HistoryPlugin />
                  )}
                  <ListPlugin />
                  <CheckListPlugin />
                  <TablePlugin
                    hasCellMerge
                    hasCellBackgroundColor
                    hasTabHandler
                  />
                  {!editingPaused && (
                    <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
                  )}
                  <LinkPlugin />
                  {!editingPaused && (
                    <SlashMenuPlugin requestMedia={requestMedia} />
                  )}
                  {!editingPaused && <FloatingFormatToolbarPlugin />}
                  {!editingPaused && <FloatingCardActionToolbarPlugin />}
                  {!editingPaused && <BlockHandleGutterPlugin />}
                  {showWordCount && <WordCountPlugin />}
                  {!editingPaused && enableAi && (
                    <InlineAIPlugin
                      disabled={!enableAi}
                      onGenerate={onAiGenerate}
                    />
                  )}
                  <EditorEditablePlugin paused={editingPaused} />
                  <InitialStatePlugin
                    document={parsedDoc}
                    replacementId={replacementId}
                    metadataRevision={metadataRevision}
                    syncRoot={!collaboration}
                    hasLocalEdits={hasLocalEdits}
                    onApplied={onApplied}
                    onError={onError}
                  />
                  <OnChangePlugin
                    onChange={(editorState, _editor, tags) => {
                      const rootJson = JSON.stringify(
                        editorState.toJSON().root,
                      );
                      if (tags.has(EXTERNAL_SYNC_TAG)) {
                        lastEditorRoot.current = rootJson;
                        return;
                      }
                      if (migrationError) {
                        dirty.current = true;
                        return;
                      }
                      if (rootJson === lastEditorRoot.current) return;
                      try {
                        const rootNode = editorState.toJSON().root;
                        const studioDoc = serializeStudioDocument(
                          rootNode,
                          resourceLimits,
                          acceptedDocument.current,
                        );
                        const stats = extractDocStats(studioDoc);
                        logForensicEvent("AFTER_SERIALIZE", {
                          childCount: stats.childCount,
                          wordCount: stats.wordCount,
                          hash: stats.hash,
                        });
                        lastEditorRoot.current = rootJson;
                        dirty.current = true;
                        setSnapshotError(null);
                        onChange?.(studioDoc);
                      } catch (error) {
                        const recoverable =
                          error instanceof Error
                            ? error
                            : new Error(String(error));
                        dirty.current = true;
                        setSnapshotError(recoverable);
                        onError?.(recoverable);
                      }
                    }}
                  />
                </div>
              </LexicalComposer>
            </fieldset>
          </div>
        </StudioMediaContext.Provider>
      </StudioUploadContext.Provider>
    </StudioErrorBoundary>
  );
}
