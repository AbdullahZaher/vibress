import React, { useState, useRef, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { ButtonCardData, StudioCardNode } from '@vibress/studio-cards';

interface Props {
  nodeKey: NodeKey;
  cardData: ButtonCardData;
}

export function ButtonCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected] = useLexicalNodeSelection(nodeKey);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const text = cardData.text || '';
  const url = cardData.url || '';
  const alignment = cardData.alignment || 'center';

  const updateCardData = (updates: Partial<ButtonCardData>) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof StudioCardNode) {
        node.setCardData({
          ...cardData,
          ...updates,
        });
      }
    });
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((prev) => !prev);
    setSelected(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const alignClass = alignment === 'left' ? 'justify-start' : alignment === 'right' ? 'justify-end' : 'justify-center';

  return (
    <div
      ref={containerRef}
      className={`vb-button-card relative w-full my-3`}
    >
      <div className={`flex w-full my-2 ${alignClass} ${isOpen || isSelected || url ? 'opacity-100' : 'opacity-50'} transition-opacity`}>
        <div className="relative inline-flex flex-col items-center">
          <button
            type="button"
            onClick={handleToggle}
            className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg cursor-pointer hover:opacity-90 select-none text-sm leading-snug shadow-sm transition"
            style={{
              outline: isOpen || isSelected ? '2px solid #6366f1' : 'none',
              outlineOffset: '3px',
            }}
          >
            {text || 'Add button text'}
          </button>

          {isOpen && (
            <div 
              className={`absolute top-full mt-2.5 studio-glassy-menu bg-card/95 dark:bg-[#1a1c20]/95 backdrop-blur-2xl p-4 rounded-xl shadow-2xl border border-border/80 dark:border-white/10 z-50 w-80 flex flex-col gap-3 text-foreground animate-in fade-in zoom-in-95 duration-150 ${
                alignment === 'left' ? 'left-0' : alignment === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Arrow pointer */}
              <div 
                className={`absolute -top-1.5 w-3 h-3 rotate-45 bg-card/95 dark:bg-[#1a1c20]/95 border-l border-t border-border/80 dark:border-white/10 ${
                  alignment === 'left' ? 'left-6' : alignment === 'right' ? 'right-6' : 'left-1/2 -translate-x-1/2'
                }`}
              />

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Button Text</label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => updateCardData({ text: e.target.value })}
                  placeholder="Add button text"
                  className="px-3 py-1.5 text-xs rounded-lg border border-border/80 bg-background/80 dark:bg-white/[0.05] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                  onFocus={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Button URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => updateCardData({ url: e.target.value })}
                  placeholder="https://..."
                  className="px-3 py-1.5 text-xs rounded-lg border border-border/80 bg-background/80 dark:bg-white/[0.05] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                  onFocus={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Alignment</label>
                <div className="flex bg-muted/60 dark:bg-white/[0.06] rounded-lg p-0.5 border border-border/60 dark:border-white/10">
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button
                      key={align}
                      onClick={() => updateCardData({ alignment: align })}
                      className={`flex-1 text-xs py-1 rounded-md capitalize transition-all ${
                        alignment === align
                          ? 'bg-card dark:bg-[#25282e] shadow-sm text-primary font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {align}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
