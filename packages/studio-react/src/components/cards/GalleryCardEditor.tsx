import { useCallback, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey } from 'lexical';
import { GalleryCardData, StudioCardNode } from '@vibress/studio-cards';

import { NestedCaptionEditor } from './NestedCaptionEditor';
import { $getNodeByKey } from 'lexical';
import { CardPlaceholder } from '../ui/CardPlaceholder';
import { useStudioUpload } from '../../upload-context';

interface Props {
  nodeKey: NodeKey;
  cardData: GalleryCardData;
}

export function GalleryCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const { uploadMedia } = useStudioUpload();
  const [uploading, setUploading] = useState(false);

  const isPopulated = cardData.images && cardData.images.length > 0;

  const onFileSelect = (files: File[]) => {
    if (files.length === 0 || !uploadMedia) return;
    // Upload every file through the durable media adapter.
    setUploading(true);
    Promise.all(
      files.map((file) => uploadMedia(file, 'gallery').catch(() => null))
    )
      .then((payloads) => {
        const newImages = payloads
          .filter((p): p is Record<string, unknown> => !!p && typeof p.src === 'string')
          .map((p) => ({ src: p.src as string, alt: (p.alt as string) || '', assetId: p.assetId as string | undefined }));
        if (newImages.length === 0) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof StudioCardNode) {
            node.setCardData({
              ...cardData,
              images: [...(cardData.images || []), ...newImages],
            });
          }
        });
      })
      .finally(() => setUploading(false));
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

  const widthClass = cardData.width && cardData.width !== 'regular' ? ` vb-width-${cardData.width}` : '';

  if (!isPopulated) {
    return (
      <CardPlaceholder
        iconType="gallery"
        title="Gallery"
        description="Click to select images, or drag and drop"
        onFileSelect={onFileSelect}
        multiple={true}
        uploading={uploading}
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
      className={`vb-gallery-card${widthClass} relative my-3.5`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? '2px solid #6366f1' : 'none',
        borderRadius: '12px',
        transition: 'outline 0.1s ease',
      }}
    >
      <div className="flex flex-wrap gap-2.5">
        {cardData.images.map((img, i) => (
          <img key={i} src={img.src} alt={img.alt || ''} className="flex-1 object-cover min-w-[200px] rounded-xl shadow-sm" style={{ maxHeight: '300px' }} />
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
