import { useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { NodeKey } from 'lexical';
import { VideoCardData } from '@vibress/studio-cards';
import { NestedCaptionEditor } from './NestedCaptionEditor';
import { $getNodeByKey } from 'lexical';
import { CardPlaceholder } from '../ui/CardPlaceholder';

interface Props {
  nodeKey: NodeKey;
  cardData: VideoCardData;
}

export function VideoCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
      
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && 'setCardData' in node) {
        (node as any).setCardData({
          ...cardData,
          src: url,
          fileName: file.name
        });
      }
    });
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
        iconType="video"
        title="Video"
        description="Click to select a video, or drag and drop"
        onFileSelect={onFileSelect}
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
      className={`vb-video-card${widthClass} relative`}
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
      <video src={cardData.src} poster={cardData.poster} controls className="w-full" />
      <NestedCaptionEditor
        initialCaptionJSON={typeof cardData.caption === 'object' ? cardData.caption : undefined}
        onChange={onCaptionChange}
        placeholder="Type caption for video (optional)"
      />
    </figure>
  );
}
