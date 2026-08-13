import React, { useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isNodeSelection } from 'lexical';
import { createPortal } from 'react-dom';
import { $isReactStudioCardNode, ReactStudioCardNode } from '../nodes/ReactStudioCardNode';
import { Trash2, Maximize2, Minimize2, Move } from 'lucide-react';

export function FloatingCardActionToolbarPlugin({ anchorElem = document.body }: { anchorElem?: HTMLElement }) {
  const [editor] = useLexicalComposerContext();
  const [selectedNode, setSelectedNode] = useState<ReactStudioCardNode | null>(null);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isNodeSelection(selection)) {
          const nodes = selection.getNodes();
          if (nodes.length === 1 && $isReactStudioCardNode(nodes[0])) {
            const card = nodes[0] as ReactStudioCardNode;
            setSelectedNode(card);
            const dom = editor.getElementByKey(card.getKey());
            if (dom) {
              setCardRect(dom.getBoundingClientRect());
            }
            return;
          }
        }
        setSelectedNode(null);
        setCardRect(null);
      });
    });
  }, [editor]);

  if (!selectedNode) return null;

  const currentWidth = (selectedNode.getCardData().width as string) || 'regular';

  const handleWidthChange = (width: 'regular' | 'wide' | 'full') => {
    editor.update(() => {
      const data = selectedNode.getCardData();
      selectedNode.setCardData({ ...data, width });
    });
  };

  const handleDelete = () => {
    editor.update(() => {
      selectedNode.remove();
    });
    setSelectedNode(null);
  };

  const topPos = cardRect ? cardRect.top + window.scrollY - 36 : 20;
  const leftPos = cardRect ? cardRect.left + window.scrollX : 20;

  return createPortal(
    <div
      className="floating-card-action-popup studio-glassy-menu animate-in fade-in zoom-in-95 duration-150"
      style={{
        position: 'absolute',
        top: `${Math.max(10, topPos)}px`,
        left: `${Math.max(10, leftPos)}px`,
        backgroundColor: 'rgba(21, 23, 26, 0.85)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        color: '#f8fafc',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '10px',
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        zIndex: 160,
        fontSize: '12px',
      }}
    >
      <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', paddingRight: '4px', letterSpacing: '0.05em' }}>
        {selectedNode.getCardType()}
      </span>

      <div style={{ width: '1px', height: '14px', backgroundColor: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

      <button
        type="button"
        onClick={() => handleWidthChange('regular')}
        style={getBtnStyle(currentWidth === 'regular')}
        title="Regular width"
      >
        <Minimize2 size={12} /> Regular
      </button>
      <button
        type="button"
        onClick={() => handleWidthChange('wide')}
        style={getBtnStyle(currentWidth === 'wide')}
        title="Wide width"
      >
        <Move size={12} /> Wide
      </button>
      <button
        type="button"
        onClick={() => handleWidthChange('full')}
        style={getBtnStyle(currentWidth === 'full')}
        title="Full screen width"
      >
        <Maximize2 size={12} /> Full
      </button>

      <div style={{ width: '1px', height: '14px', backgroundColor: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

      <button
        type="button"
        onClick={handleDelete}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#f87171',
          padding: '4px 7px',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          fontWeight: 500,
          transition: 'all 0.15s ease',
        }}
      >
        <Trash2 size={12} /> Delete
      </button>
    </div>,
    anchorElem
  );
}

function getBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
    color: active ? '#60a5fa' : '#e2e8f0',
    border: 'none',
    padding: '4px 7px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: active ? 600 : 400,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    transition: 'all 0.15s ease',
  };
}
