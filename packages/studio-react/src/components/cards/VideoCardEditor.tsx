import { useCallback, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey } from 'lexical';
import { VideoCardData, StudioCardNode } from '@vibress/studio-cards';

import { NestedCaptionEditor } from './NestedCaptionEditor';
import { $getNodeByKey } from 'lexical';
import { CardPlaceholder } from '../ui/CardPlaceholder';
import { useStudioUpload } from '../../upload-context';

interface Props {
  nodeKey: NodeKey;
  cardData: VideoCardData;
}

export function VideoCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const { uploadMedia } = useStudioUpload();
  const [uploading, setUploading] = useState(false);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file || !uploadMedia) return;
    setUploading(true);
    uploadMedia(file, 'video')
      .then((payload) => {
        if (!payload) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof StudioCardNode) {
            node.setCardData({ ...cardData, ...payload, fileName: file.name });
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
        iconType="video"
        title="Video"
        description="Click to select a video, or drag and drop"
        onFileSelect={onFileSelect}
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
      className={`vb-video-card${widthClass} relative my-3.5`}
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
      <video src={cardData.src} poster={cardData.poster} controls className="w-full rounded-xl overflow-hidden shadow-sm" />
      <NestedCaptionEditor
        initialCaptionJSON={typeof cardData.caption === 'object' ? cardData.caption : undefined}
        onChange={onCaptionChange}
        placeholder="Type caption for video (optional)"
      />
    </figure>
  );
}
