import { useRef, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { CalloutCardData, StudioCardNode } from '@vibress/studio-cards';


interface Props {
  nodeKey: NodeKey;
  cardData: CalloutCardData;
}

const BG_COLORS: Record<string, string> = {
  grey: 'bg-muted/80 dark:bg-white/[0.05] text-foreground border-border/80 dark:border-white/10 backdrop-blur-sm',
  blue: 'bg-blue-500/10 dark:bg-blue-500/15 text-blue-950 dark:text-blue-200 border-blue-500/25 backdrop-blur-sm',
  green: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-950 dark:text-emerald-200 border-emerald-500/25 backdrop-blur-sm',
  yellow: 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-950 dark:text-amber-200 border-amber-500/25 backdrop-blur-sm',
  red: 'bg-rose-500/10 dark:bg-rose-500/15 text-rose-950 dark:text-rose-200 border-rose-500/25 backdrop-blur-sm',
  pink: 'bg-pink-500/10 dark:bg-pink-500/15 text-pink-950 dark:text-pink-200 border-pink-500/25 backdrop-blur-sm',
  purple: 'bg-purple-500/10 dark:bg-purple-500/15 text-purple-950 dark:text-purple-200 border-purple-500/25 backdrop-blur-sm',
};

export function CalloutCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = cardData.text || '';
  const emoji = cardData.emoji || '💡';
  const bgColor = cardData.backgroundColor || 'grey';

  const updateCardData = (updates: Partial<CalloutCardData>) => {
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [text]);

  const colorClass = BG_COLORS[bgColor] || BG_COLORS.grey;

  return (
    <div
      className={`vb-callout-card relative w-full my-3.5 rounded-xl border py-3.5 px-4 flex items-start gap-3.5 ${colorClass}`}
      onClick={(e) => {
        clearSelection();
        setSelected(true);
        if (!isSelected) {
          e.preventDefault(); // Prevent immediately focusing textarea if just selecting
        }
      }}
      style={{
        outline: isSelected ? '2px solid #6366f1' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex-shrink-0 text-2xl leading-none flex items-start pt-0.5">
        <input
          type="text"
          value={emoji}
          onChange={(e) => {
             const val = e.target.value;
             const newEmoji = (val.trim() ? Array.from(val.trim())[0] : '💡') || '💡';
             updateCardData({ emoji: newEmoji });
          }}
          className="w-7 h-7 bg-transparent border-none outline-none text-center rounded focus:ring-2 focus:ring-blue-400"
          onFocus={(e) => {
             e.stopPropagation();
             e.target.select();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          onKeyPress={(e) => e.stopPropagation()}
        />
      </div>

      <div className="flex-1 min-w-0">
        <textarea
           ref={textareaRef}
           value={text}
           onChange={(e) => updateCardData({ text: e.target.value })}
           placeholder="Type callout text here..."
           className="w-full bg-transparent outline-none resize-none placeholder-current opacity-70 focus:opacity-100"
           rows={1}
           onFocus={(e) => e.stopPropagation()}
           onKeyDown={(e) => e.stopPropagation()}
           onKeyUp={(e) => e.stopPropagation()}
           onKeyPress={(e) => e.stopPropagation()}
        />
      </div>

      {isSelected && (
        <div className="absolute top-full right-0 mt-2 studio-glassy-menu bg-card/95 dark:bg-[#1a1c20]/95 backdrop-blur-xl p-2 rounded-xl shadow-2xl border border-border/80 dark:border-white/10 z-20 flex gap-1.5 animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
          {Object.keys(BG_COLORS).map((color) => (
            <button
              key={color}
              onClick={() => updateCardData({ backgroundColor: color })}
              className={`w-6 h-6 rounded-full border border-border/60 ${(BG_COLORS[color] || '').split(' ')[0]} ${bgColor === color ? 'ring-2 ring-primary ring-offset-1' : 'hover:scale-110 transition-transform'}`}
              title={color}
            />
          ))}
        </div>
      )}
    </div>
  );
}
