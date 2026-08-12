import { z } from 'zod';
import { escapeHtml, sanitizeHtml, sanitizeUrl, parseMarkdownToHtml } from '@vibress/studio-utils';
import { DecoratorNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';

export interface StudioCardDefinition<TData = Record<string, unknown>> {
  type: string;
  version: number;
  validate(data: unknown): TData;
  renderHtml(data: TData): string;
  renderPlainText(data: TData): string;
}

// 1. Image Card
export const ImageCardSchema = z.object({
  assetId: z.string().optional(),
  src: z.string(),
  alt: z.string().default(''),
  caption: z.union([z.string(), z.record(z.unknown())]).default(''),
  captionHtml: z.string().optional(),
  width: z.enum(['regular', 'wide', 'full']).optional().default('regular'),
  height: z.number().optional(),
  href: z.string().optional(),
});
export type ImageCardData = z.infer<typeof ImageCardSchema>;

export const ImageCardDefinition: StudioCardDefinition<ImageCardData> = {
  type: 'image',
  version: 1,
  validate: (data) => ImageCardSchema.parse(data),
  renderHtml: (data) => {
    const src = sanitizeUrl(data.src);
    const alt = escapeHtml(data.alt || '');
    const capStr = data.captionHtml || (typeof data.caption === 'string' ? data.caption : '');
    const caption = capStr ? `<figcaption>${sanitizeHtml(capStr)}</figcaption>` : '';
    const img = `<img src="${src}" alt="${alt}" />`;
    const layoutClass = data.width && data.width !== 'regular' ? ` kg-width-${data.width}` : '';
    if (data.href) {
      return `<figure class="kg-card kg-image-card${layoutClass}"><a href="${sanitizeUrl(data.href)}">${img}</a>${caption}</figure>`;
    }
    return `<figure class="kg-card kg-image-card${layoutClass}">${img}${caption}</figure>`;
  },
  renderPlainText: (data) => {
    const capStr = data.captionHtml || (typeof data.caption === 'string' ? data.caption : '');
    return data.alt || capStr || data.src || '';
  },
};

// 2. Gallery Card
export const GalleryCardSchema = z.object({
  images: z.array(ImageCardSchema),
  caption: z.union([z.string(), z.record(z.unknown())]).default(''),
  captionHtml: z.string().optional(),
  width: z.enum(['regular', 'wide', 'full']).optional().default('regular'),
});
export type GalleryCardData = z.infer<typeof GalleryCardSchema>;

export const GalleryCardDefinition: StudioCardDefinition<GalleryCardData> = {
  type: 'gallery',
  version: 1,
  validate: (data) => GalleryCardSchema.parse(data),
  renderHtml: (data) => {
    const imgs = data.images
      .map((img) => `<img src="${sanitizeUrl(img.src)}" alt="${escapeHtml(img.alt || '')}" />`)
      .join('');
    const capStr = data.captionHtml || (typeof data.caption === 'string' ? data.caption : '');
    const caption = capStr ? `<figcaption>${sanitizeHtml(capStr)}</figcaption>` : '';
    const layoutClass = data.width && data.width !== 'regular' ? ` kg-width-${data.width}` : '';
    return `<figure class="kg-card kg-gallery-card${layoutClass}">${imgs}${caption}</figure>`;
  },
  renderPlainText: (data) => data.images.map((i) => i.alt).filter(Boolean).join(', '),
};

// 3. Video Card
export const VideoCardSchema = z.object({
  assetId: z.string().optional(),
  src: z.string(),
  caption: z.union([z.string(), z.record(z.unknown())]).default(''),
  captionHtml: z.string().optional(),
  poster: z.string().optional(),
  loop: z.boolean().default(false),
  autoplay: z.boolean().default(false),
  width: z.enum(['regular', 'wide', 'full']).optional().default('regular'),
});
export type VideoCardData = z.infer<typeof VideoCardSchema>;

export const VideoCardDefinition: StudioCardDefinition<VideoCardData> = {
  type: 'video',
  version: 1,
  validate: (data) => VideoCardSchema.parse(data),
  renderHtml: (data) => {
    const src = sanitizeUrl(data.src);
    const posterAttr = data.poster ? ` poster="${sanitizeUrl(data.poster)}"` : '';
    const capStr = data.captionHtml || (typeof data.caption === 'string' ? data.caption : '');
    const caption = capStr ? `<figcaption>${sanitizeHtml(capStr)}</figcaption>` : '';
    const layoutClass = data.width && data.width !== 'regular' ? ` kg-width-${data.width}` : '';
    return `<figure class="kg-card kg-video-card${layoutClass}"><video src="${src}" controls${posterAttr}></video>${caption}</figure>`;
  },
  renderPlainText: (data) => {
    const capStr = data.captionHtml || (typeof data.caption === 'string' ? data.caption : '');
    return capStr || data.src || '';
  },
};

// 4. Audio Card
export const AudioCardSchema = z.object({
  assetId: z.string().optional(),
  src: z.string(),
  title: z.string().default(''),
  caption: z.union([z.string(), z.record(z.unknown())]).default(''),
});
export type AudioCardData = z.infer<typeof AudioCardSchema>;

export const AudioCardDefinition: StudioCardDefinition<AudioCardData> = {
  type: 'audio',
  version: 1,
  validate: (data) => AudioCardSchema.parse(data),
  renderHtml: (data) => {
    const src = sanitizeUrl(data.src);
    const title = data.title ? `<div class="title">${escapeHtml(data.title)}</div>` : '';
    return `<div class="kg-card kg-audio-card">${title}<audio src="${src}" controls></audio></div>`;
  },
  renderPlainText: (data) => {
    const capStr = typeof data.caption === 'string' ? data.caption : '';
    return data.title || capStr || data.src || '';
  },
};

// 5. File Card
export const FileCardSchema = z.object({
  assetId: z.string().optional(),
  src: z.string(),
  fileName: z.string(),
  fileSize: z.string().default(''),
  caption: z.union([z.string(), z.record(z.unknown())]).default(''),
});
export type FileCardData = z.infer<typeof FileCardSchema>;

export const FileCardDefinition: StudioCardDefinition<FileCardData> = {
  type: 'file',
  version: 1,
  validate: (data) => FileCardSchema.parse(data),
  renderHtml: (data) => {
    const src = sanitizeUrl(data.src);
    const name = escapeHtml(data.fileName);
    const size = data.fileSize ? ` <span class="size">(${escapeHtml(data.fileSize)})</span>` : '';
    return `<div class="kg-card kg-file-card"><a href="${src}" download>${name}${size}</a></div>`;
  },
  renderPlainText: (data) => {
    const capStr = typeof data.caption === 'string' ? data.caption : '';
    return data.fileName || capStr || data.src || '';
  },
};

// 6. Bookmark Card
export const BookmarkCardSchema = z.object({
  url: z.string(),
  title: z.string().default(''),
  description: z.string().default(''),
  author: z.string().default(''),
  publisher: z.string().default(''),
  thumbnail: z.string().default(''),
  icon: z.string().default(''),
});
export type BookmarkCardData = z.infer<typeof BookmarkCardSchema>;

export const BookmarkCardDefinition: StudioCardDefinition<BookmarkCardData> = {
  type: 'bookmark',
  version: 1,
  validate: (data) => BookmarkCardSchema.parse(data),
  renderHtml: (data) => {
    const url = sanitizeUrl(data.url);
    const title = escapeHtml(data.title || data.url);
    const desc = escapeHtml(data.description || '');
    return `<figure class="kg-card kg-bookmark-card"><a href="${url}"><div class="title">${title}</div><div class="desc">${desc}</div></a></figure>`;
  },
  renderPlainText: (data) => data.title || data.url || '',
};

// 7. Embed Card
export const EmbedCardSchema = z.object({
  url: z.string(),
  embedType: z.string().default('video'),
  html: z.string().optional(),
  caption: z.union([z.string(), z.record(z.unknown())]).default(''),
});
export type EmbedCardData = z.infer<typeof EmbedCardSchema>;

export const EmbedCardDefinition: StudioCardDefinition<EmbedCardData> = {
  type: 'embed',
  version: 1,
  validate: (data) => EmbedCardSchema.parse(data),
  renderHtml: (data) => {
    const url = sanitizeUrl(data.url);
    if (data.html) {
      return `<figure class="kg-card kg-embed-card">${sanitizeHtml(data.html)}</figure>`;
    }
    return `<figure class="kg-card kg-embed-card"><iframe src="${url}"></iframe></figure>`;
  },
  renderPlainText: (data) => {
    const capStr = typeof data.caption === 'string' ? data.caption : '';
    return data.url || capStr || '';
  },
};

// 8. Button Card
export const ButtonCardSchema = z.object({
  text: z.string(),
  url: z.string(),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
});
export type ButtonCardData = z.infer<typeof ButtonCardSchema>;

export const ButtonCardDefinition: StudioCardDefinition<ButtonCardData> = {
  type: 'button',
  version: 1,
  validate: (data) => ButtonCardSchema.parse(data),
  renderHtml: (data) => {
    const url = sanitizeUrl(data.url);
    const text = escapeHtml(data.text);
    return `<div class="kg-card kg-button-card align-${data.alignment}"><a href="${url}" class="btn">${text}</a></div>`;
  },
  renderPlainText: (data) => `${data.text} (${data.url})`,
};

// 9. Callout Card
export const CalloutCardSchema = z.object({
  text: z.string(),
  emoji: z.string().default('💡'),
  backgroundColor: z.string().default('grey'),
});
export type CalloutCardData = z.infer<typeof CalloutCardSchema>;

export const CalloutCardDefinition: StudioCardDefinition<CalloutCardData> = {
  type: 'callout',
  version: 1,
  validate: (data) => CalloutCardSchema.parse(data),
  renderHtml: (data) => {
    const emoji = escapeHtml(data.emoji);
    const content = sanitizeHtml(data.text);
    return `<div class="kg-card kg-callout-card bg-${data.backgroundColor}"><span class="emoji">${emoji}</span><div class="content">${content}</div></div>`;
  },
  renderPlainText: (data) => `${data.emoji} ${data.text}`,
};

// 10. Toggle Card
export const ToggleCardSchema = z.object({
  heading: z.string(),
  content: z.string(),
});
export type ToggleCardData = z.infer<typeof ToggleCardSchema>;

export const ToggleCardDefinition: StudioCardDefinition<ToggleCardData> = {
  type: 'toggle',
  version: 1,
  validate: (data) => ToggleCardSchema.parse(data),
  renderHtml: (data) => {
    const heading = escapeHtml(data.heading);
    const content = sanitizeHtml(data.content);
    return `<details class="kg-card kg-toggle-card"><summary>${heading}</summary><div>${content}</div></details>`;
  },
  renderPlainText: (data) => `${data.heading}\n${data.content}`,
};

// 11. Markdown Card
export const MarkdownCardSchema = z.object({
  markdown: z.string(),
});
export type MarkdownCardData = z.infer<typeof MarkdownCardSchema>;

export const MarkdownCardDefinition: StudioCardDefinition<MarkdownCardData> = {
  type: 'markdown',
  version: 1,
  validate: (data) => MarkdownCardSchema.parse(data),
  renderHtml: (data) => parseMarkdownToHtml(data.markdown),
  renderPlainText: (data) => data.markdown || '',
};

// 12. HTML Card (Privileged raw HTML card - sanitized before render)
export const HtmlCardSchema = z.object({
  html: z.string(),
});
export type HtmlCardData = z.infer<typeof HtmlCardSchema>;

export const HtmlCardDefinition: StudioCardDefinition<HtmlCardData> = {
  type: 'html',
  version: 1,
  validate: (data) => HtmlCardSchema.parse(data),
  renderHtml: (data) => data.html,
  renderPlainText: (data) => data.html || '',
};

// 13. Divider Card
export const DividerCardSchema = z.object({
  style: z.string().default('solid'),
});
export type DividerCardData = z.infer<typeof DividerCardSchema>;

export const DividerCardDefinition: StudioCardDefinition<DividerCardData> = {
  type: 'divider',
  version: 1,
  validate: (data) => DividerCardSchema.parse(data),
  renderHtml: () => '<hr />',
  renderPlainText: () => '---',
};

export const STUDIO_CARD_DEFINITIONS: Record<string, StudioCardDefinition> = {
  image: ImageCardDefinition,
  gallery: GalleryCardDefinition,
  video: VideoCardDefinition,
  audio: AudioCardDefinition,
  file: FileCardDefinition,
  bookmark: BookmarkCardDefinition,
  embed: EmbedCardDefinition,
  button: ButtonCardDefinition,
  callout: CalloutCardDefinition,
  toggle: ToggleCardDefinition,
  markdown: MarkdownCardDefinition,
  html: HtmlCardDefinition,
  divider: DividerCardDefinition,
};

// Generic Lexical StudioCardNode for Lexical Editor representation
export type SerializedStudioCardNode = Spread<
  {
    cardType: string;
    cardData: Record<string, unknown>;
  },
  SerializedLexicalNode
>;

export class StudioCardNode extends DecoratorNode<JSX.Element | string> {
  __cardType: string;
  __cardData: Record<string, unknown>;

  static getType(): string {
    return 'studio-card';
  }

  static clone(node: StudioCardNode): StudioCardNode {
    return new StudioCardNode(node.__cardType, node.__cardData, node.__key);
  }

  constructor(cardType: string, cardData: Record<string, unknown>, key?: NodeKey) {
    super(key);
    this.__cardType = cardType;
    this.__cardData = cardData;
  }

  getCardType(): string {
    return this.__cardType;
  }

  getCardData(): Record<string, unknown> {
    return this.__cardData;
  }

  setCardData(cardData: Record<string, unknown>): void {
    const writable = this.getWritable();
    writable.__cardData = cardData;
  }

  exportJSON(): SerializedStudioCardNode {
    return {
      type: 'studio-card',
      cardType: this.__cardType,
      cardData: this.__cardData,
      version: 1,
    };
  }

  static importJSON(serializedNode: SerializedStudioCardNode): StudioCardNode {
    return $createStudioCardNode(serializedNode.cardType, serializedNode.cardData);
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = `studio-card studio-card-${this.__cardType}`;
    return div;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element | string {
    const def = STUDIO_CARD_DEFINITIONS[this.__cardType];
    if (def) {
      try {
        const validated = def.validate(this.__cardData);
        return def.renderHtml(validated);
      } catch {
        return `[Card: ${this.__cardType}]`;
      }
    }
    return `[Unknown Card: ${this.__cardType}]`;
  }
}

export function $createStudioCardNode(
  cardType: string,
  cardData: Record<string, unknown>
): StudioCardNode {
  return new StudioCardNode(cardType, cardData);
}

export function $isStudioCardNode(node: unknown): node is StudioCardNode {
  return node instanceof StudioCardNode;
}
