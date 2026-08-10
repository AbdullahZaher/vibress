import { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND } from 'lexical';
import { createPortal } from 'react-dom';

function getDOMRangeRect(nativeSelection: Selection): DOMRect | null {
  const domRange = nativeSelection.getRangeAt(0);
  let rect = domRange.getBoundingClientRect();
  
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return rect;
}

function setFloatingElemPosition(
  targetRect: DOMRect | null,
  floatingElem: HTMLElement
): void {
  if (targetRect === null) {
    floatingElem.style.opacity = '0';
    floatingElem.style.transform = 'translate(-10000px, -10000px)';
    return;
  }

  const floatingElemRect = floatingElem.getBoundingClientRect();

  const top = targetRect.top - floatingElemRect.height - 10;
  const left = targetRect.left + targetRect.width / 2 - floatingElemRect.width / 2;

  floatingElem.style.opacity = '1';
  floatingElem.style.transform = `translate(${left}px, ${top}px)`;
}

export function FloatingFormatToolbarPlugin({ anchorElem = document.body }: { anchorElem?: HTMLElement }) {
  const [editor] = useLexicalComposerContext();
  const [isTextSelected, setIsTextSelected] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updatePopup = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const nativeSelection = window.getSelection();
      const rootElement = editor.getRootElement();

      if (
        nativeSelection !== null &&
        (!$isRangeSelection(selection) ||
          rootElement === null ||
          !rootElement.contains(nativeSelection.anchorNode) ||
          nativeSelection.isCollapsed)
      ) {
        setIsTextSelected(false);
        return;
      }

      setIsTextSelected(true);
      if ($isRangeSelection(selection)) {
        setIsBold(selection.hasFormat('bold'));
        setIsItalic(selection.hasFormat('italic'));
        setIsUnderline(selection.hasFormat('underline'));
        setIsStrikethrough(selection.hasFormat('strikethrough'));
      }
    });
  }, [editor]);

  useEffect(() => {
    document.addEventListener('selectionchange', updatePopup);
    return () => {
      document.removeEventListener('selectionchange', updatePopup);
    };
  }, [updatePopup]);

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      updatePopup();
    });
  }, [editor, updatePopup]);

  useEffect(() => {
    if (isTextSelected && toolbarRef.current) {
      const nativeSelection = window.getSelection();
      if (nativeSelection && !nativeSelection.isCollapsed) {
        const rootElement = editor.getRootElement();
        if (rootElement) {
          const rect = getDOMRangeRect(nativeSelection);
          setFloatingElemPosition(rect, toolbarRef.current);
        }
      }
    }
  }, [isTextSelected, anchorElem, editor, updatePopup]);

  if (!isTextSelected) {
    return null;
  }

  return createPortal(
    <div
      ref={toolbarRef}
      className="floating-text-format-popup"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        opacity: 0,
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        padding: '4px',
        display: 'flex',
        gap: '4px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        transition: 'opacity 0.2s ease-in-out',
        zIndex: 100,
        pointerEvents: 'auto',
      }}
    >
      <button
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
        style={{
          background: isBold ? '#334155' : 'transparent',
          color: '#f8fafc',
          border: 'none',
          padding: '6px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        B
      </button>
      <button
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
        style={{
          background: isItalic ? '#334155' : 'transparent',
          color: '#f8fafc',
          border: 'none',
          padding: '6px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontStyle: 'italic',
        }}
      >
        I
      </button>
      <button
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
        style={{
          background: isUnderline ? '#334155' : 'transparent',
          color: '#f8fafc',
          border: 'none',
          padding: '6px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        U
      </button>
      <button
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}
        style={{
          background: isStrikethrough ? '#334155' : 'transparent',
          color: '#f8fafc',
          border: 'none',
          padding: '6px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          textDecoration: 'line-through',
        }}
      >
        S
      </button>
    </div>,
    anchorElem
  );
}
