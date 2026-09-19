import { useCallback, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { NodeKey, $getNodeByKey } from "lexical";
import { VideoCardData, StudioCardNode } from "@vibress/studio-cards";

import { NestedCaptionEditor } from "./NestedCaptionEditor";
import { CardPlaceholder } from "../ui/CardPlaceholder";
import { useStudioMedia } from "../../media-context";
import { StudioMediaFloatingToolbar } from "../ui/StudioMediaFloatingToolbar";
import { VideoMetadataPopover } from "../ui/media-popovers/VideoMetadataPopover";

interface Props {
  nodeKey: NodeKey;
  cardData: VideoCardData;
}

export function VideoCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const { uploadMedia, requestMedia } = useStudioMedia();
  const [uploading, setUploading] = useState(false);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file || !uploadMedia) return;
    setUploading(true);
    uploadMedia(file, "video")
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

  const handleChangeFromLibrary = useCallback(async () => {
    if (!requestMedia) return;
    const payload = await requestMedia({
      cardType: "video",
      source: "library",
    });
    if (!payload) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node instanceof StudioCardNode) {
        node.setCardData({
          ...cardData,
          ...payload,
        });
      }
    });
  }, [editor, nodeKey, cardData, requestMedia]);

  const handleMetadataUpdate = useCallback(
    (data: {
      caption: string;
      poster?: string | undefined;
      loop?: boolean | undefined;
      autoplay?: boolean | undefined;
    }) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            caption: data.caption,
            captionHtml: data.caption,
            poster: data.poster,
            loop: data.loop ?? false,
            autoplay: data.autoplay ?? false,
          });
        }
      });
    },
    [editor, nodeKey, cardData],
  );

  const handleWidthChange = useCallback(
    (newWidth: "regular" | "wide" | "full") => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            width: newWidth,
          });
        }
      });
    },
    [editor, nodeKey, cardData],
  );

  const handleDelete = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
      }
    });
  }, [editor, nodeKey]);

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
    [editor, nodeKey, cardData],
  );

  const widthClass =
    typeof cardData.width === "string" && cardData.width !== "regular"
      ? ` vb-width-${cardData.width}`
      : "";

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

  const captionStr =
    typeof cardData.caption === "string"
      ? cardData.caption
      : cardData.captionHtml || "";

  return (
    <figure
      className={`vb-video-card${widthClass} relative group my-3.5`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? "2px solid #6366f1" : "none",
        borderRadius: "12px",
        transition: "outline 0.1s ease",
      }}
    >
      <StudioMediaFloatingToolbar
        onChange={requestMedia ? handleChangeFromLibrary : undefined}
        changeLabel="Change"
        changeTitle="Change video from library"
        metadataLabel="Settings"
        metadataTitle="Edit video settings and caption"
        metadataContent={
          <VideoMetadataPopover
            caption={captionStr}
            poster={cardData.poster || ""}
            loop={cardData.loop}
            autoplay={cardData.autoplay}
            onUpdate={handleMetadataUpdate}
            onClose={() => {}}
          />
        }
        width={
          typeof cardData.width === "string"
            ? (cardData.width as "regular" | "wide" | "full")
            : "regular"
        }
        onWidthChange={handleWidthChange}
        onDelete={handleDelete}
        deleteTitle="Remove video"
        isSelected={isSelected}
      />

      <video
        src={cardData.src}
        poster={cardData.poster}
        controls
        loop={cardData.loop}
        autoPlay={cardData.autoplay}
        className="w-full rounded-xl overflow-hidden shadow-sm"
      />
      {captionStr ? (
        <figcaption className="mt-2 text-center text-xs text-muted-foreground">
          {captionStr}
        </figcaption>
      ) : (
        <NestedCaptionEditor
          initialCaptionJSON={
            typeof cardData.caption === "object" ? cardData.caption : undefined
          }
          onChange={onCaptionChange}
          placeholder="Type caption for video (optional)"
        />
      )}
    </figure>
  );
}

