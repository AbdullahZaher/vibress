import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey, $getNodeByKey } from 'lexical';
import { BookmarkCardData } from '@vibress/studio-cards';
import { UrlPlaceholder } from '../ui/UrlPlaceholder';

interface Props {
  nodeKey: NodeKey;
  cardData: BookmarkCardData;
}

export function BookmarkCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const isPopulated = !!cardData.url;

  const onUrlSubmit = (url: string) => {
    // In a real app, this would hit an API endpoint to fetch oEmbed metadata
    // For now, we mock some metadata based on the URL
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && 'setCardData' in node) {
        (node as any).setCardData({
          ...cardData,
          url,
          title: new URL(url).hostname,
          description: 'A bookmark link',
        });
      }
    });
  };

  if (!isPopulated) {
    return (
      <UrlPlaceholder
        iconType="bookmark"
        title="Bookmark"
        description="Paste a URL to add a bookmark"
        onUrlSubmit={onUrlSubmit}
        isSelected={isSelected}
        onClick={() => {
          clearSelection();
          setSelected(true);
        }}
      />
    );
  }

  return (
    <figure
      className={`vb-bookmark-card relative w-full mb-4`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
        transition: 'outline 0.1s ease',
      }}
    >
      <a href={cardData.url} target="_blank" rel="noopener noreferrer" className="flex border rounded-md overflow-hidden hover:bg-gray-50 bg-white no-underline text-current shadow-sm" style={{ height: '140px' }}>
        <div className="flex flex-col flex-1 p-4 justify-between min-w-0">
          <div>
            <div className="font-semibold truncate mb-1 text-sm">{cardData.title || cardData.url}</div>
            <div className="text-sm text-gray-500 line-clamp-2">{cardData.description}</div>
          </div>
          <div className="flex items-center mt-2 text-xs text-gray-500">
            {cardData.icon && <img src={cardData.icon} alt="" className="w-4 h-4 mr-2" />}
            <span className="truncate">{cardData.publisher || new URL(cardData.url).hostname}</span>
            {cardData.author && <span className="before:content-['•'] before:mx-1 truncate">{cardData.author}</span>}
          </div>
        </div>
        {cardData.thumbnail && (
          <div className="w-[140px] flex-shrink-0 relative overflow-hidden bg-gray-100 border-l hidden sm:block">
            <img src={cardData.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        )}
      </a>
    </figure>
  );
}
