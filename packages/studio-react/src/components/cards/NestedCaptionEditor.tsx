import { useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalNestedComposer } from '@lexical/react/LexicalNestedComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { createEditor, EditorState } from 'lexical';
// We don't have generateHtmlFromNodes in @vibress/studio-html yet, so we will use @lexical/html later or pass it from parent.
import { $generateHtmlFromNodes } from '@lexical/html';

export interface NestedCaptionEditorProps {
  initialCaptionJSON?: Record<string, unknown> | undefined;
  placeholder?: string;
  onChange: (captionJSON: Record<string, unknown>, captionHtml: string) => void;
}

export function NestedCaptionEditor({
  initialCaptionJSON,
  placeholder = 'Type caption...',
  onChange,
}: NestedCaptionEditorProps) {
  const [parentEditor] = useLexicalComposerContext();
  const [captionEditor] = useState(() => {
    const editor = createEditor({
      nodes: Array.from(parentEditor._nodes.values()).map(n => n.klass),
      theme: parentEditor._config.theme,
      namespace: parentEditor._config.namespace + '-caption',
      onError: (e) => console.error(e),
    });

    if (initialCaptionJSON && Object.keys(initialCaptionJSON).length > 0) {
      try {
        const parsed = editor.parseEditorState(initialCaptionJSON as never);
        editor.setEditorState(parsed);
      } catch (e) {
        console.error('Failed to parse caption JSON', e);
      }
    }
    return editor;
  });

  return (
    <LexicalNestedComposer initialEditor={captionEditor}>
      <div className="vibress-caption-editor relative mt-2 text-center text-xs text-muted-foreground">
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="outline-none min-h-[24px] px-2 py-1 focus:bg-muted/40 dark:focus:bg-white/[0.04] rounded-lg transition text-foreground/80 placeholder:text-muted-foreground" />
          }
          placeholder={
            <div className="absolute top-1 left-0 right-0 pointer-events-none opacity-50 text-muted-foreground">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin
          onChange={(editorState: EditorState, editor) => {
            editorState.read(() => {
              const html = $generateHtmlFromNodes(editor, null);
              onChange(editorState.toJSON() as unknown as Record<string, unknown>, html);
            });
          }}
        />
      </div>
    </LexicalNestedComposer>
  );
}
