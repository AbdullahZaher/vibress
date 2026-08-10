import React, { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import { $getNodeByKey, $getSelection, $isNodeSelection, COMMAND_PRIORITY_LOW, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, NodeKey } from 'lexical';
import { STUDIO_CARD_DEFINITIONS } from '@vibress/studio-cards';
import { ImageCardEditor } from './cards/ImageCardEditor';
import { VideoCardEditor } from './cards/VideoCardEditor';
import { GalleryCardEditor } from './cards/GalleryCardEditor';
import { AudioCardEditor } from './cards/AudioCardEditor';
import { FileCardEditor } from './cards/FileCardEditor';
import { BookmarkCardEditor } from './cards/BookmarkCardEditor';
import { EmbedCardEditor } from './cards/EmbedCardEditor';
import { ButtonCardEditor } from './cards/ButtonCardEditor';
import { CalloutCardEditor } from './cards/CalloutCardEditor';
import { ToggleCardEditor } from './cards/ToggleCardEditor';
import { MarkdownCardEditor } from './cards/MarkdownCardEditor';
import { HtmlCardEditor } from './cards/HtmlCardEditor';

// Registry of cards that have rich interactive React editors
const INTERACTIVE_CARDS: Record<string, React.FC<{ nodeKey: NodeKey; cardData: any }>> = {
  image: ImageCardEditor,
  video: VideoCardEditor,
  gallery: GalleryCardEditor,
  audio: AudioCardEditor,
  file: FileCardEditor,
  bookmark: BookmarkCardEditor,
  embed: EmbedCardEditor,
  button: ButtonCardEditor,
  callout: CalloutCardEditor,
  toggle: ToggleCardEditor,
  markdown: MarkdownCardEditor,
  html: HtmlCardEditor,
};

export function StudioCardComponent({
  cardType,
  cardData,
  nodeKey,
}: {
  cardType: string;
  cardData: Record<string, unknown>;
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        payload.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if (node) {
          node.remove();
        }
        return true;
      }
      return false;
    },
    [isSelected, nodeKey]
  );

  React.useEffect(() => {
    return mergeRegister(
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW)
    );
  }, [editor, onDelete]);

  // If we have an interactive editor component for this card type, render it!
  const InteractiveEditor = INTERACTIVE_CARDS[cardType];
  if (InteractiveEditor) {
    return <InteractiveEditor nodeKey={nodeKey} cardData={cardData} />;
  }

  // Otherwise, fallback to static HTML rendering
  const def = STUDIO_CARD_DEFINITIONS[cardType];
  let html = `[Unknown Card: ${cardType}]`;
  if (def) {
    try {
      const validated = def.validate(cardData);
      html = def.renderHtml(validated);
    } catch {
      html = `[Card: ${cardType}] Error`;
    }
  }

  return (
    <div
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
        position: 'relative',
        cursor: 'pointer',
        padding: '2px',
        borderRadius: '4px',
        transition: 'outline 0.1s ease',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
