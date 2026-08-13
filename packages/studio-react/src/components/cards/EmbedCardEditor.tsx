import { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { EmbedCardData, StudioCardNode } from '@vibress/studio-cards';

import { NestedCaptionEditor } from './NestedCaptionEditor';
import { UrlPlaceholder } from '../ui/UrlPlaceholder';

interface Props {
  nodeKey: NodeKey;
  cardData: EmbedCardData;
}

export function EmbedCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const isPopulated = !!cardData.url;

  const onUrlSubmit = (url: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof StudioCardNode) {
        node.setCardData({
          ...cardData,
          url,
        });
      }
    });
  };

  const onCaptionChange = useCallback(
    (captionJSON: Record<string, unknown>, captionHtml: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            caption: captionJSON,
            captionHtml,
          });
        }
      });
    },
    [editor, nodeKey, cardData]
  );

  if (!isPopulated) {
    return (
      <UrlPlaceholder
        iconType="embed"
        title="Embed"
        description="Paste a URL to embed content (e.g. YouTube, Vimeo)"
        onUrlSubmit={onUrlSubmit}
        isSelected={isSelected}
        onClick={() => {
          clearSelection();
          setSelected(true);
        }}
      />
    );
  }

  // Very basic iframe rendering. In a real app you would process the URL to get proper embed codes (like turning youtube watch URLs into embed URLs)
  let src = cardData.url;
  if (src.includes('youtube.com/watch?v=')) {
    src = src.replace('youtube.com/watch?v=', 'youtube.com/embed/');
  }

  return (
    <figure
      className={`vb-embed-card relative w-full mb-4 flex flex-col gap-2`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #6366f1' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="relative w-full overflow-hidden bg-muted/60 dark:bg-white/[0.04] rounded-xl border border-border/80 dark:border-white/10 shadow-sm" style={{ paddingTop: '56.25%' /* 16:9 Aspect Ratio */ }}>
        {cardData.html ? (
           <div className="absolute top-0 left-0 w-full h-full" dangerouslySetInnerHTML={{ __html: cardData.html }} />
        ) : (
          <iframe
            className="absolute top-0 left-0 w-full h-full"
            src={src}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="Embedded content"
          />
        )}
      </div>
      <NestedCaptionEditor
        initialCaptionJSON={typeof cardData.caption === 'object' ? cardData.caption : undefined}
        onChange={onCaptionChange}
        placeholder="Type caption for embed (optional)"
      />
    </figure>
  );
}
