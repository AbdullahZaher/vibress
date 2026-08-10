import { useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isNodeSelection } from 'lexical';
import { createPortal } from 'react-dom';
import { $isReactStudioCardNode, ReactStudioCardNode } from '../nodes/ReactStudioCardNode';

export function FloatingCardActionToolbarPlugin({ anchorElem = document.body }: { anchorElem?: HTMLElement }) {
  const [editor] = useLexicalComposerContext();
  const [selectedNode, setSelectedNode] = useState<ReactStudioCardNode | null>(null);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isNodeSelection(selection)) {
          const nodes = selection.getNodes();
          if (nodes.length === 1 && $isReactStudioCardNode(nodes[0])) {
            setSelectedNode(nodes[0] as ReactStudioCardNode);
            return;
          }
        }
        setSelectedNode(null);
      });
    });
  }, [editor]);

  if (!selectedNode) return null;

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
  };

  return createPortal(
    <div
      className="floating-card-action-popup"
      style={{
        position: 'absolute',
        top: '20px', // simplified static positioning for demo, in production should attach to node DOM rect
        right: '20px',
        backgroundColor: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '6px',
        display: 'flex',
        gap: '6px',
        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        zIndex: 100,
      }}
    >
      <span style={{ fontSize: '12px', color: '#64748b', alignSelf: 'center', marginRight: '8px' }}>
        {selectedNode.getCardType().toUpperCase()}
      </span>
      <button onClick={() => handleWidthChange('regular')} style={btnStyle}>
        Regular
      </button>
      <button onClick={() => handleWidthChange('wide')} style={btnStyle}>
        Wide
      </button>
      <button onClick={() => handleWidthChange('full')} style={btnStyle}>
        Full
      </button>
      <div style={{ width: '1px', backgroundColor: '#e2e8f0', margin: '0 4px' }} />
      <button onClick={handleDelete} style={{ ...btnStyle, color: '#ef4444' }}>
        Delete
      </button>
    </div>,
    anchorElem
  );
}

const btnStyle = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  padding: '4px 8px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  color: '#0f172a',
};
