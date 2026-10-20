import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { NodeKey, $getNodeByKey } from "lexical";
import { EmbedCardData, StudioCardNode } from "@vibress/studio-cards";
import { getEmbedProvider, sanitizeStudioHtml } from "@vibress/studio-utils";

import { NestedCaptionEditor } from "./NestedCaptionEditor";
import { UrlPlaceholder } from "../ui/UrlPlaceholder";
import { StudioMediaFloatingToolbar } from "../ui/StudioMediaFloatingToolbar";
import { EmbedMetadataPopover } from "../ui/media-popovers/EmbedMetadataPopover";

interface Props {
  nodeKey: NodeKey;
  cardData: EmbedCardData;
}

export function EmbedCardEditor({ nodeKey, cardData }: Props) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

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

  const handleMetadataUpdate = useCallback(
    (data: { url: string; caption: string }) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof StudioCardNode) {
          node.setCardData({
            ...cardData,
            url: data.url,
            caption: data.caption,
            captionHtml: data.caption,
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

  // Preview only approved providers, matching the public Studio renderer.
  const provider = getEmbedProvider(cardData.url);
  const externalUrl = /^https?:\/\//i.test(cardData.url.trim())
    ? cardData.url.trim()
    : null;

  const captionStr =
    typeof cardData.caption === "string" ? cardData.caption : "";

  return (
    <figure
      className={`vb-embed-card relative group w-full mb-4 flex flex-col gap-2`}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      style={{
        outline: isSelected ? "2px solid #6366f1" : "none",
        transition: "outline 0.1s ease",
      }}
    >
      <StudioMediaFloatingToolbar
        metadataLabel="Edit URL / Caption"
        metadataTitle="Edit embed URL and caption"
        metadataContent={
          <EmbedMetadataPopover
            url={cardData.url || ""}
            caption={captionStr}
            onUpdate={handleMetadataUpdate}
            onClose={() => {}}
          />
        }
        onDelete={handleDelete}
        deleteTitle="Remove embed"
        isSelected={isSelected}
      />

      <div
        className="relative w-full overflow-hidden bg-muted/60 dark:bg-white/[0.04] rounded-xl border border-border/80 dark:border-white/10 shadow-sm"
        style={{ paddingTop: "56.25%" /* 16:9 Aspect Ratio */ }}
      >
        {cardData.html ? (
          <div
            className="absolute top-0 left-0 w-full h-full"
            dangerouslySetInnerHTML={{ __html: sanitizeStudioHtml(cardData.html) }}
          />
        ) : provider ? (
          <iframe
            className="absolute top-0 left-0 w-full h-full"
            src={provider.embedUrl}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            title="Embedded content"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            {externalUrl ? (
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                Open embedded content
              </a>
            ) : (
              <span>Unsupported embed URL</span>
            )}
          </div>
        )}
      </div>
      <NestedCaptionEditor
        initialCaptionJSON={
          typeof cardData.caption === "object" ? cardData.caption : undefined
        }
        onChange={onCaptionChange}
        placeholder="Type caption for embed (optional)"
      />
    </figure>
  );
}

