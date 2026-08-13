import { useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TRANSFORMERS } from '@lexical/markdown';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, $createParagraphNode } from 'lexical';
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin';
import { FloatingFormatToolbarPlugin } from './plugins/FloatingFormatToolbarPlugin';
import { FloatingCardActionToolbarPlugin } from './plugins/FloatingCardActionToolbarPlugin';
import { BlockHandleGutterPlugin } from './plugins/BlockHandleGutterPlugin';
import { InlineAIPlugin } from './plugins/InlineAIPlugin';
import { STUDIO_CORE_NODES } from '@vibress/studio-nodes';
import { StudioCardNode } from '@vibress/studio-cards';
import { ReactStudioCardNode } from './nodes/ReactStudioCardNode';
import { StudioDocument, migrateDocument } from '@vibress/studio-core';
import { serializeStudioDocument } from '@vibress/studio-serializer';
import { StudioUploadContext, StudioUploadApi } from './upload-context';

export interface VibressStudioProps {
  value?: unknown;
  onChange?: (doc: StudioDocument) => void;
  readOnly?: boolean;
  placeholder?: string;
  onError?: (error: Error) => void;
  requestMedia?: (req: { cardType: string }) => Promise<Record<string, unknown> | null>;
  /** Durable upload adapter: local file → assetId/src payload. Card editors
   *  must use this instead of transient blob: URLs. */
  uploadMedia?: StudioUploadApi['uploadMedia'];
  className?: string;
}

interface StudioErrorBoundaryProps {
  children: ReactNode;
  onError?: ((err: Error) => void) | undefined;
}

class StudioErrorBoundary extends Component<StudioErrorBoundaryProps, { hasError: boolean }> {
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
        <div style={{ padding: '12px', border: '1px solid red', borderRadius: '4px', background: '#fff0f0', color: '#c00' }}>
          <strong>Studio Error:</strong> The editor encountered an issue displaying content.
        </div>
      );
    }
    return this.props.children;
  }
}

function InitialStatePlugin({ document }: { document: StudioDocument }) {
  const [editor] = useLexicalComposerContext();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    editor.update(() => {
      const root = $getRoot();
      if (document && document.root) {
        try {
          const editorState = editor.parseEditorState({ root: { ...document.root, version: 1 } } as never);
          editor.setEditorState(editorState);
        } catch (err) {
          console.error("Failed to parse editor state", err);
          root.clear();
          root.append($createParagraphNode());
        }
      } else {
        root.clear();
        root.append($createParagraphNode());
      }
    });
  }, [document, editor]);

  return null;
}

export function VibressStudio({
  value,
  onChange,
  readOnly = false,
  placeholder = 'Write content with Vibress Studio (type "/" for commands, Space for AI)...',
  onError,
  requestMedia,
  uploadMedia,
  className = '',
}: VibressStudioProps) {
  const parsedDoc = useMemo(() => migrateDocument(value), [value]);

  const initialConfig = useMemo(
    () => ({
      namespace: 'VibressStudio',
      nodes: [
        ...STUDIO_CORE_NODES,
        ReactStudioCardNode,
        {
          replace: StudioCardNode,
          // IMPORTANT: do not pass the original node's key. $setNodeKey
          // already registered the original under that key; a replacement
          // with the same key never enters the node map. A fresh key makes
          // the replacement the real rendered node.
          with: (node: StudioCardNode) => {
            return new ReactStudioCardNode(node.getCardType(), node.getCardData());
          },
        },
      ],
      editable: !readOnly,
      onError: (error: Error) => {
        if (onError) onError(error);
      },
      theme: {
        paragraph: 'studio-paragraph',
        heading: {
          h1: 'studio-h1',
          h2: 'studio-h2',
          h3: 'studio-h3',
        },
        list: {
          ul: 'studio-ul',
          ol: 'studio-ol',
          listitem: 'studio-listitem',
          nested: {
            listitem: 'studio-nested-listitem',
          },
          listitemChecked: 'studio-checklist-checked',
          listitemUnchecked: 'studio-checklist-unchecked',
        },
        table: 'studio-table',
        tableCell: 'studio-table-cell',
        tableCellHeader: 'studio-table-cell-header',
        tableRow: 'studio-table-row',
        quote: 'studio-quote',
        code: 'studio-code-block',
        text: {
          bold: 'studio-bold',
          italic: 'studio-italic',
          underline: 'studio-underline',
          strikethrough: 'studio-strikethrough',
          code: 'studio-code',
        },
      },
    }),
    [readOnly, onError]
  );

  return (
    <StudioErrorBoundary onError={onError}>
      <StudioUploadContext.Provider value={{ uploadMedia }}>
        <div className={`vibress-studio-editor ${className}`}>
          <LexicalComposer initialConfig={initialConfig}>
            <div style={{ position: 'relative', minHeight: '30vh', paddingLeft: '32px' }}>
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    style={{
                      outline: 'none',
                      minHeight: '30vh',
                      fontSize: '1.0625rem',
                      lineHeight: '1.75',
                      color: 'inherit',
                    }}
                  />
                }
                placeholder={
                  <div
                    style={{
                      position: 'absolute',
                      top: '0',
                      left: '32px',
                      color: '#94a3b8',
                      pointerEvents: 'none',
                      fontSize: '1.0625rem',
                    }}
                  >
                    {placeholder}
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <CheckListPlugin />
              <TablePlugin hasCellMerge hasCellBackgroundColor hasTabHandler />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              <LinkPlugin />
              <SlashMenuPlugin requestMedia={requestMedia} />
              <FloatingFormatToolbarPlugin />
              <FloatingCardActionToolbarPlugin />
              {!readOnly && <BlockHandleGutterPlugin />}
              {!readOnly && <InlineAIPlugin />}
              <InitialStatePlugin document={parsedDoc} />
              {onChange && (
                <OnChangePlugin
                  onChange={(editorState) => {
                    const rootNode = editorState.toJSON().root;
                    const studioDoc = serializeStudioDocument(rootNode);
                    onChange(studioDoc);
                  }}
                />
              )}
            </div>
          </LexicalComposer>
        </div>
      </StudioUploadContext.Provider>
    </StudioErrorBoundary>
  );
}
