import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from 'lexical';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { createPortal } from 'react-dom';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  Sparkles,
  ChevronDown,
  Palette,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
} from 'lucide-react';
import { turnSelectedBlockInto, TurnIntoType } from './TurnIntoHelper';

const NOTION_COLORS = [
  { name: 'Default', color: 'inherit', bg: 'transparent' },
  { name: 'Gray', color: '#64748b', bg: '#f1f5f9' },
  { name: 'Brown', color: '#92400e', bg: '#fef3c7' },
  { name: 'Orange', color: '#c2410c', bg: '#ffedd5' },
  { name: 'Yellow', color: '#a16207', bg: '#fef9c3' },
  { name: 'Green', color: '#15803d', bg: '#dcfce7' },
  { name: 'Blue', color: '#1d4ed8', bg: '#dbeafe' },
  { name: 'Purple', color: '#7e22ce', bg: '#f3e8ff' },
  { name: 'Pink', color: '#be185d', bg: '#fce7f3' },
  { name: 'Red', color: '#b91c1c', bg: '#fee2e2' },
];

function getDOMRangeRect(nativeSelection: Selection): DOMRect | null {
  if (nativeSelection.rangeCount === 0) return null;
  const domRange = nativeSelection.getRangeAt(0);
  const rect = domRange.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return rect;
}

function setFloatingElemPosition(targetRect: DOMRect | null, floatingElem: HTMLElement): void {
  if (targetRect === null) {
    floatingElem.style.opacity = '0';
    floatingElem.style.transform = 'translate(-10000px, -10000px)';
    return;
  }

  const floatingElemRect = floatingElem.getBoundingClientRect();
  let top = targetRect.top + window.scrollY - floatingElemRect.height - 10;
  let left = targetRect.left + window.scrollX + targetRect.width / 2 - floatingElemRect.width / 2;

  // Prevent overflowing viewport
  if (left < 10) left = 10;
  if (left + floatingElemRect.width > window.innerWidth - 10) {
    left = window.innerWidth - floatingElemRect.width - 10;
  }
  if (top < 10) {
    top = targetRect.bottom + window.scrollY + 10; // flip below if at the top
  }

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
  const [isCode, setIsCode] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'turnInto' | 'color' | null>(null);

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
        setIsCode(selection.hasFormat('code'));
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

  const handleTurnInto = (type: TurnIntoType) => {
    turnSelectedBlockInto(editor, type);
    setOpenDropdown(null);
  };

  const handleApplyColor = (color: string, bg: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        // Apply inline style to selection
        const nodes = selection.getNodes();
        nodes.forEach((node) => {
          const dom = editor.getElementByKey(node.getKey());
          if (dom) {
            if (color !== 'inherit') dom.style.color = color;
            if (bg !== 'transparent') dom.style.backgroundColor = bg;
          }
        });
      }
    });
    setOpenDropdown(null);
  };

  const handleLink = () => {
    const url = prompt('Enter link URL:');
    if (url) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    }
  };

  return createPortal(
    <div
      ref={toolbarRef}
      className="notion-floating-format-popup"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        opacity: 0,
        backgroundColor: '#1e293b',
        color: '#f8fafc',
        borderRadius: '8px',
        padding: '4px 6px',
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
        transition: 'opacity 0.15s ease-in-out',
        zIndex: 150,
        pointerEvents: 'auto',
        fontSize: '13px',
      }}
    >
      {/* Ask AI button */}
      <button
        type="button"
        title="Ask AI"
        onClick={() => {
          alert('Select "Ask AI" from slash command or press Space on a new line.');
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'linear-gradient(135deg, #9333ea 0%, #4f46e5 100%)',
          color: '#fff',
          border: 'none',
          padding: '4px 8px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
        }}
      >
        <Sparkles size={13} />
        <span>Ask AI</span>
      </button>

      <div style={{ width: '1px', height: '18px', backgroundColor: '#334155', margin: '0 2px' }} />

      {/* Turn into selector */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === 'turnInto' ? null : 'turnInto')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            background: openDropdown === 'turnInto' ? '#334155' : 'transparent',
            color: '#f8fafc',
            border: 'none',
            padding: '4px 6px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          <span>Turn into</span>
          <ChevronDown size={12} />
        </button>

        {openDropdown === 'turnInto' && (
          <div
            style={{
              position: 'absolute',
              top: '28px',
              left: 0,
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '4px',
              width: '160px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              zIndex: 200,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
            }}
          >
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('paragraph')}>Text</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('h1')}><Heading1 size={13} /> Heading 1</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('h2')}><Heading2 size={13} /> Heading 2</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('h3')}><Heading3 size={13} /> Heading 3</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('check-list')}><CheckSquare size={13} /> To-do list</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('bullet-list')}><List size={13} /> Bullet list</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('number-list')}><ListOrdered size={13} /> Numbered list</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('quote')}><Quote size={13} /> Quote</button>
            <button style={dropdownItemStyle} onClick={() => handleTurnInto('code')}><Code size={13} /> Code</button>
          </div>
        )}
      </div>

      <div style={{ width: '1px', height: '18px', backgroundColor: '#334155', margin: '0 2px' }} />

      {/* Formatting buttons */}
      <button
        type="button"
        title="Bold (Ctrl+B)"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
        style={getFormatBtnStyle(isBold)}
      >
        <Bold size={13} />
      </button>
      <button
        type="button"
        title="Italic (Ctrl+I)"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
        style={getFormatBtnStyle(isItalic)}
      >
        <Italic size={13} />
      </button>
      <button
        type="button"
        title="Underline (Ctrl+U)"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
        style={getFormatBtnStyle(isUnderline)}
      >
        <Underline size={13} />
      </button>
      <button
        type="button"
        title="Strikethrough"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}
        style={getFormatBtnStyle(isStrikethrough)}
      >
        <Strikethrough size={13} />
      </button>
      <button
        type="button"
        title="Inline Code"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
        style={getFormatBtnStyle(isCode)}
      >
        <Code size={13} />
      </button>
      <button
        type="button"
        title="Add Link"
        onClick={handleLink}
        style={getFormatBtnStyle(false)}
      >
        <Link size={13} />
      </button>

      <div style={{ width: '1px', height: '18px', backgroundColor: '#334155', margin: '0 2px' }} />

      {/* Color Palette */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          title="Text & Highlight Color"
          onClick={() => setOpenDropdown(openDropdown === 'color' ? null : 'color')}
          style={{
            background: openDropdown === 'color' ? '#334155' : 'transparent',
            color: '#f8fafc',
            border: 'none',
            padding: '4px 6px',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <Palette size={13} />
        </button>

        {openDropdown === 'color' && (
          <div
            style={{
              position: 'absolute',
              top: '28px',
              right: 0,
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px',
              width: '180px',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '4px',
              zIndex: 200,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
            }}
          >
            {NOTION_COLORS.map((c) => (
              <button
                key={c.name}
                title={c.name}
                onClick={() => handleApplyColor(c.color, c.bg)}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '4px',
                  border: '1px solid #475569',
                  backgroundColor: c.bg === 'transparent' ? '#334155' : c.bg,
                  color: c.color === 'inherit' ? '#f8fafc' : c.color,
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                A
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    anchorElem
  );
}

function getFormatBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#334155' : 'transparent',
    color: active ? '#38bdf8' : '#f8fafc',
    border: 'none',
    padding: '4px 6px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 8px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '12px',
  color: '#f8fafc',
  width: '100%',
};
