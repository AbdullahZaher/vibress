import { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey } from 'lexical';
import { GalleryCardData } from '@vibress/studio-cards';
import { NestedCaptionEditor } from './NestedCaptionEditor';
import { $getNodeByKey } from 'lexical';
import { CardPlaceholder } from '../ui/CardPlaceholder';

interface Props {
  nodeKey: NodeKey;
  cardData: GalleryCardData;
}

export function GalleryCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const isPopulated = cardData.images && cardData.images.length > 0;

  const onFileSelect = (files: File[]) => {
    if (files.length > 0) {
      const newImages = files.map(file => ({
        src: URL.createObjectURL(file),
        alt: file.name
      }));
      
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && 'setCardData' in node) {
          (node as any).setCardData({
            ...cardData,
            images: [...(cardData.images || []), ...newImages]
          });
        }
      });
    }
  };

  const onCaptionChange = useCallback(
    (captionJSON: Record<string, any>, captionHtml: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && 'setCardData' in node) {
          (node as any).setCardData({
            ...cardData,
            caption: captionJSON,
            captionHtml,
          });
        }
      });
    },
    [editor, nodeKey, cardData]
  );

  const widthClass = cardData.width && cardData.width !== 'regular' ? ` vb-width-${cardData.width}` : '';

  if (!isPopulated) {
    return (
      <CardPlaceholder
        iconType="gallery"
        title="Gallery"
        description="Click to select images, or drag and drop"
        onFileSelect={onFileSelect}
        multiple={true}
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
      className={`vb-gallery-card${widthClass} relative`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #3b82f6' : 'none',
        borderRadius: '4px',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex flex-wrap gap-2">
        {cardData.images.map((img, i) => (
          <img key={i} src={img.src} alt={img.alt || ''} className="flex-1 object-cover min-w-[200px]" style={{ maxHeight: '300px' }} />
        ))}
      </div>
      <NestedCaptionEditor
        initialCaptionJSON={typeof cardData.caption === 'object' ? cardData.caption : undefined}
        onChange={onCaptionChange}
        placeholder="Type caption for gallery (optional)"
      />
    </figure>
  );
}
