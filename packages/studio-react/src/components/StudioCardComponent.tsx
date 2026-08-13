import React, { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import { $getNodeByKey, $getSelection, $isNodeSelection, $createNodeSelection, $setSelection, COMMAND_PRIORITY_LOW, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, NodeKey } from 'lexical';
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
const INTERACTIVE_CARDS = {
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
} as unknown as Record<string, React.FC<{ nodeKey: NodeKey; cardData: Record<string, unknown> }>>;

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

  /**
   * Lexical selection lifecycle fix.
   *
   * Decorator nodes render OUTSIDE the contenteditable root element. A plain
   * click on the card therefore blurs the editor, and Lexical's selection
   * reconciliation nulls the selection (editor loses "active" focus) — so the
   * node selection set by the card editors' onClick is wiped immediately and
   * `isSelected` never becomes true.
   *
   * Fix (proper Lexical APIs, no parallel React selection state):
   *  - mousedown on the card CHROME is preventDefault-ed (keeps the editor
   *    focused) and the node selection is set directly via
   *    $createNodeSelection().add(key) + $setSelection.
   *  - interactive controls (inputs/textareas/buttons/links) keep native
   *    behavior; when focus enters them the card re-asserts the node
   *    selection so the editing form stays open while typing.
   */
  const selectCard = useCallback(
    (opts: { focus?: boolean } = {}) => {
      // Lexical's editor.focus() never focuses the DOM root element. The
      // browser must focus the contenteditable so the editor stays "active".
      // Focusing triggers a DOM selectionchange that Lexical reconciles into a
      // RangeSelection — so the node selection is applied on the NEXT tick,
      // after that reconciliation settles; it is never marked dirty, so it is
      // not written back to the DOM and cannot be reconciled away.
      if (opts.focus) {
        editor.getRootElement()?.focus();
        window.setTimeout(() => selectCard({ focus: false }), 0);
        return;
      }
      editor.update(() => {
        const selection = $createNodeSelection();
        selection.add(nodeKey);
        $setSelection(selection);
      });
    },
    [editor, nodeKey]
  );

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    // Inside popovers, toolbars, or nested form inputs: keep native interactive behavior
    if (target.closest('.studio-glassy-menu, .floating-card-action-popup, form, input, textarea, select')) {
      return true;
    }
    // Nested Lexical editors (e.g. caption editors) are also interactive.
    const editable = target.closest('[contenteditable="true"]');
    if (editable && editable !== editor.getRootElement()) return true;
    return false;
  };

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (isInteractiveTarget(event.target)) {
        return; // inputs/buttons keep native behavior
      }
      // preventDefault stops the browser from moving the DOM selection
      // inside the contenteditable (which would make Lexical reconcile a
      // RangeSelection over our node selection); focus the editor root and
      // select the card via the proper Lexical API.
      event.preventDefault();
      selectCard({ focus: true });
    },
    [selectCard, editor]
  );

  const handleFocusCapture = useCallback(() => {
    // Focus entered the card (e.g. a form field). Re-assert the node
    // selection WITHOUT stealing focus from the field, so the editing UI
    // stays open while the user types.
    selectCard({ focus: false });
  }, [selectCard]);

  React.useEffect(() => {
    return mergeRegister(
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW)
    );
  }, [editor, onDelete]);

  // If we have an interactive editor component for this card type, render it!
  const InteractiveEditor = INTERACTIVE_CARDS[cardType];
  if (InteractiveEditor) {
    return (
      <div
        data-studio-card={cardType}
        onMouseDown={handleMouseDown}
        onFocusCapture={handleFocusCapture}
      >
        <InteractiveEditor nodeKey={nodeKey} cardData={cardData} />
      </div>
    );
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
        outline: isSelected ? '2px solid #6366f1' : 'none',
        position: 'relative',
        cursor: 'pointer',
        padding: '2px',
        borderRadius: '8px',
        transition: 'outline 0.1s ease',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
