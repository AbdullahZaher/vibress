import { useCallback, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { NodeKey, $getNodeByKey } from "lexical";
import { ImageCardData, StudioCardNode } from "@vibress/studio-cards";

import { NestedCaptionEditor } from "./NestedCaptionEditor";
import { CardPlaceholder } from "../ui/CardPlaceholder";
import { useStudioMedia } from "../../media-context";
import { StudioMediaFloatingToolbar } from "../ui/StudioMediaFloatingToolbar";
import { ImageMetadataPopover } from "../ui/media-popovers/ImageMetadataPopover";

interface Props {
  nodeKey: NodeKey;
  cardData: ImageCardData;
}

export function ImageCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const { uploadMedia, requestMedia, allowUnsplash } = useStudioMedia();
  const [uploading, setUploading] = useState(false);

  const isPopulated = !!cardData.src;

  const onFileSelect = (files: File[]) => {
    const file = files[0];
    if (!file || !uploadMedia) return;
    setUploading(true);
    uploadMedia(file, "image")
      .then((payload) => {
        if (!payload) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof StudioCardNode) {
            node.setCardData({ ...cardData, ...payload });
          }
        });
      })
      .finally(() => setUploading(false));
  };

  const handleChangeFromLibrary = useCallback(async () => {
    if (!requestMedia) return;
    const payload = await requestMedia({
      cardType: "image",
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

  const handleUnsplash = useCallback(async () => {
    if (!requestMedia) return;
    const payload = await requestMedia({
      cardType: "image",
      source: "unsplash",
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
    (data: { alt: string; caption: string; href?: string | undefined }) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            alt: data.alt,
            caption: data.caption,
            captionHtml: data.caption,
            href: data.href,
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
        iconType="image"
        title="Image"
        description="Click to select an image, or drag and drop"
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
      className={`vb-image-card${widthClass} relative group my-3.5`}
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
        changeTitle="Change image from library"
        onUnsplash={
          requestMedia && allowUnsplash !== false ? handleUnsplash : undefined
        }
        metadataLabel="Alt / Caption"
        metadataTitle="Edit alt text and caption"
        metadataContent={
          <ImageMetadataPopover
            alt={cardData.alt || ""}
            caption={captionStr}
            href={cardData.href || ""}
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
        deleteTitle="Remove image"
        isSelected={isSelected}
      />

      <img
        src={cardData.src}
        alt={cardData.alt || ""}
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
          placeholder="Type caption for image (optional)"
        />
      )}
    </figure>
  );
}

