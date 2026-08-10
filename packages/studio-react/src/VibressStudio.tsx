import { useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, $createParagraphNode } from 'lexical';
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin';
import { FloatingFormatToolbarPlugin } from './plugins/FloatingFormatToolbarPlugin';
import { FloatingCardActionToolbarPlugin } from './plugins/FloatingCardActionToolbarPlugin';
import { STUDIO_CORE_NODES } from '@vibress/studio-nodes';
import { StudioCardNode } from '@vibress/studio-cards';
import { ReactStudioCardNode } from './nodes/ReactStudioCardNode';
import { StudioDocument, migrateDocument } from '@vibress/studio-core';
import { serializeStudioDocument } from '@vibress/studio-serializer';

export interface VibressStudioProps {
  value?: unknown;
  onChange?: (doc: StudioDocument) => void;
  readOnly?: boolean;
  placeholder?: string;
  onError?: (error: Error) => void;
  requestMedia?: (req: { cardType: string }) => Promise<Record<string, unknown> | null>;
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

// Toolbar has been removed to match the distraction-free floating-only approach.

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
          const editorState = editor.parseEditorState({ root: { ...document.root, version: 1 } } as any);
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
  placeholder = 'Write content with Vibress Studio...',
  onError,
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
          with: (node: StudioCardNode) => {
            return new ReactStudioCardNode(node.getCardType(), node.getCardData(), node.getKey());
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
      <div className={`vibress-studio-editor ${className}`}>
        <LexicalComposer initialConfig={initialConfig}>
          <div style={{ position: 'relative', minHeight: '20vh' }}>
            <RichTextPlugin
              contentEditable={<ContentEditable style={{ outline: 'none', minHeight: '20vh', fontSize: '1.125rem', lineHeight: '1.7', color: 'inherit' }} />}
              placeholder={
                <div style={{ position: 'absolute', top: '0', left: '0', color: '#94a3b8', pointerEvents: 'none', fontSize: '1.125rem' }}>
                  {placeholder}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <ListPlugin />
            <LinkPlugin />
            <SlashMenuPlugin />
            <FloatingFormatToolbarPlugin />
            <FloatingCardActionToolbarPlugin />
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
    </StudioErrorBoundary>
  );
}
