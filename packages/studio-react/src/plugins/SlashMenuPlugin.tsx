import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { filterSlashMenuOptions } from './slash-menu-filter';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $getSelection,
  $getNodeByKey,
  $isRangeSelection,
  TextNode,
  $createParagraphNode,
} from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createListNode, $createListItemNode } from '@lexical/list';
import { $createCodeNode } from '@lexical/code';
import { $createTableNodeWithDimensions } from '@lexical/table';
import {
  $createReactStudioCardNode,
  $isReactStudioCardNode,
} from '../nodes/ReactStudioCardNode';
import { createPortal } from 'react-dom';
import {
  ImageIcon,
  Video,
  Images,
  File as FileIcon,
  Code,
  Minus,
  MessageSquare,
  Box,
  MousePointerClick,
  Table as TableIcon,
  CheckSquare,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Bookmark,
  ChevronRight,
  Code2,
  Layers,
} from 'lucide-react';

export class StudioMenuOption extends MenuOption {
  title: string;
  category: 'basic' | 'card' | 'ai';
  cardType?: string | undefined;
  actionType?: string | undefined;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  description: string;
  keywords?: string[] | undefined;

  constructor(
    title: string,
    category: 'basic' | 'card' | 'ai',
    icon: React.ReactNode,
    description: string,
    extra?: { cardType?: string; actionType?: string; badge?: React.ReactNode; keywords?: string[] }
  ) {
    super(title);
    this.title = title;
    this.category = category;
    this.icon = icon;
    this.description = description;
    this.cardType = extra?.cardType;
    this.actionType = extra?.actionType;
    this.badge = extra?.badge;
    this.keywords = extra?.keywords;
  }
}

function SlashMenuPortalContent({
  anchorElement,
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
  queryString,
}: {
  anchorElement: HTMLElement;
  options: StudioMenuOption[];
  selectedIndex: number | null;
  selectOptionAndCleanUp: (opt: StudioMenuOption) => void;
  setHighlightedIndex: (idx: number) => void;
  queryString?: string | null | undefined;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const clampAnchor = () => {
      const currentLeft = parseFloat(anchorElement.style.left || '0');
      const viewportWidth = window.visualViewport?.width || window.innerWidth;
      const menuWidth = menuRef.current?.getBoundingClientRect().width || 540;

      const minLeft = 12;
      const maxLeft = Math.max(12, viewportWidth - 12 - menuWidth);

      if (currentLeft < minLeft) {
        anchorElement.style.left = `${minLeft}px`;
      } else if (currentLeft > maxLeft) {
        anchorElement.style.left = `${maxLeft}px`;
      }
    };

    clampAnchor();

    const observer = new MutationObserver(() => {
      clampAnchor();
    });

    observer.observe(anchorElement, {
      attributes: true,
      attributeFilter: ['style'],
    });

    return () => {
      observer.disconnect();
    };
  }, [anchorElement]);

  if (options.length === 0) {
    return (
      <div
        ref={menuRef}
        role="region"
        aria-label="Slash commands"
        className="notion-slash-menu studio-glassy-menu"
        style={{
          position: 'absolute',
          top: '24px',
          left: 0,
          width: '320px',
          maxWidth: 'calc(100vw - 24px)',
          zIndex: 250,
          padding: '16px 12px',
          boxSizing: 'border-box',
          background: 'var(--vb-studio-popover, var(--popover, #ffffff))',
          border: '1px solid var(--vb-studio-border, var(--border, #e2e8f0))',
          borderRadius: '12px',
          boxShadow: 'var(--vb-studio-shadow-popover, 0 12px 32px -4px rgba(0, 0, 0, 0.12))',
          color: 'var(--vb-studio-foreground-muted, var(--muted-foreground, #64748b))',
          textAlign: 'center',
          fontSize: '13px',
        }}
      >
        <div role="status" aria-live="polite">
          No matching blocks for &ldquo;{queryString || ''}&rdquo;
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Insert card"
      className="notion-slash-menu studio-glassy-menu"
      style={{
        position: 'absolute',
        top: '24px',
        left: 0,
        width: '540px',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: '380px',
        overflowY: 'auto',
        zIndex: 250,
        padding: '8px 10px',
        boxSizing: 'border-box',
        background: 'var(--vb-studio-popover, var(--popover, #ffffff))',
        border: '1px solid var(--vb-studio-border, var(--border, #e2e8f0))',
        borderRadius: '12px',
        boxShadow: 'var(--vb-studio-shadow-popover, 0 12px 32px -4px rgba(0, 0, 0, 0.12))',
        color: 'var(--vb-studio-popover-foreground, var(--popover-foreground, #0f172a))',
      }}
    >
      <div
        role="presentation"
        className="studio-slash-header"
        style={{
          padding: '4px 8px 6px 8px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--vb-studio-foreground-muted, var(--muted-foreground, #64748b))',
          userSelect: 'none',
        }}
      >
        {queryString ? `Matching Blocks (${options.length})` : 'Block Types'}
      </div>
      <div
        className="studio-slash-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '4px 6px',
          boxSizing: 'border-box',
        }}
      >
        {options.map((option, index) => {
          const isSelected = selectedIndex === index;
          return (
            <div
              key={option.title}
              ref={option.setRefElement}
              id={`typeahead-item-${index}`}
              role="option"
              aria-label={option.title}
              aria-selected={isSelected}
              tabIndex={-1}
              title={`${option.title} — ${option.description}`}
              onClick={() => selectOptionAndCleanUp(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`studio-slash-item ${isSelected ? 'is-selected' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                minHeight: '36px',
                boxSizing: 'border-box',
                userSelect: 'none',
                background: isSelected ? 'var(--vb-studio-surface-muted, var(--muted, #f1f5f9))' : 'transparent',
              }}
            >
              <div
                className="studio-slash-badge"
                aria-hidden="true"
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: 'var(--vb-studio-surface, var(--card, #ffffff))',
                  border: '1px solid var(--vb-studio-border, var(--border, #e2e8f0))',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                  color: 'var(--vb-studio-foreground, var(--foreground, #0f172a))',
                  fontSize: '11px',
                  lineHeight: 1,
                }}
              >
                {option.badge || option.icon}
              </div>
              <span
                className="studio-slash-title"
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--vb-studio-foreground, var(--foreground, #0f172a))',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                }}
              >
                {option.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SlashMenuPlugin({
  requestMedia,
}: {
  requestMedia?: ((req: { cardType: string }) => Promise<Record<string, unknown> | null>) | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  });

  const baseOptions: StudioMenuOption[] = useMemo(() => {
    return [
      // Column 1: Core Text, Headings & Tables (Notion Style)
      new StudioMenuOption(
        'Text',
        'basic',
        <Box size={14} />,
        'Just start writing with plain text',
        { actionType: 'paragraph', badge: <span style={{ fontFamily: 'serif', fontWeight: 600, fontSize: '12px' }}>Aa</span>, keywords: ['نص', 'فقرة', 'text', 'paragraph', 'كتابة'] }
      ),
      new StudioMenuOption(
        'Heading 1',
        'basic',
        <Heading1 size={14} />,
        'Large section heading',
        { actionType: 'h1', badge: <span style={{ fontWeight: 700, fontSize: '11px' }}>H1</span>, keywords: ['عنوان', 'رئيسي', 'heading', 'h1'] }
      ),
      new StudioMenuOption(
        'Heading 2',
        'basic',
        <Heading2 size={14} />,
        'Medium section heading',
        { actionType: 'h2', badge: <span style={{ fontWeight: 700, fontSize: '11px' }}>H2</span>, keywords: ['عنوان', 'فرعي', 'heading', 'h2'] }
      ),
      new StudioMenuOption(
        'Heading 3',
        'basic',
        <Heading3 size={14} />,
        'Small section heading',
        { actionType: 'h3', badge: <span style={{ fontWeight: 700, fontSize: '11px' }}>H3</span>, keywords: ['عنوان', 'صغير', 'heading', 'h3'] }
      ),
      new StudioMenuOption(
        'Quote',
        'basic',
        <Quote size={14} />,
        'Capture a quotation or callout quote',
        { actionType: 'quote', badge: <span style={{ fontFamily: 'serif', fontSize: '14px', lineHeight: 1 }}>“</span>, keywords: ['اقتباس', 'مقولة', 'quote', 'blockquote'] }
      ),
      new StudioMenuOption(
        'Code Block',
        'basic',
        <Code size={14} />,
        'Capture a code snippet with syntax highlighting',
        { actionType: 'code', badge: <span style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 700 }}>&lt;/&gt;</span>, keywords: ['كود', 'شفرة', 'برمجة', 'code', 'snippet'] }
      ),
      new StudioMenuOption(
        'Table',
        'basic',
        <TableIcon size={14} color="#3b82f6" />,
        'Add a flexible 3x3 table grid',
        { actionType: 'table', badge: <TableIcon size={12} color="#3b82f6" />, keywords: ['جدول', 'table', 'grid', 'بيانات'] }
      ),
      new StudioMenuOption(
        'Divider',
        'basic',
        <Minus size={14} />,
        'Visually divide blocks with a line',
        { cardType: 'divider', badge: <span style={{ fontSize: '12px', fontWeight: 900 }}>—</span>, keywords: ['فاصل', 'خط', 'divider', 'hr', 'line'] }
      ),

      // Column 2: Lists, Structure & Interactive Blocks
      new StudioMenuOption(
        'Numbered list',
        'basic',
        <ListOrdered size={14} />,
        'Create a numbered list',
        { actionType: 'number-list', badge: <span style={{ fontSize: '10px', fontWeight: 600 }}>1.=</span>, keywords: ['قائمة رقمية', 'أرقام', 'numbered', 'list'] }
      ),
      new StudioMenuOption(
        'Bulleted list',
        'basic',
        <List size={14} />,
        'Create a simple bulleted list',
        { actionType: 'bullet-list', badge: <span style={{ fontSize: '11px', fontWeight: 700 }}>•-</span>, keywords: ['قائمة نقطية', 'نقاط', 'bullet', 'list'] }
      ),
      new StudioMenuOption(
        'To-do list',
        'basic',
        <CheckSquare size={14} color="#10b981" />,
        'Track tasks with a to-do checklist',
        { actionType: 'check-list', badge: <CheckSquare size={12} color="#10b981" />, keywords: ['قائمة مهام', 'مهام', 'todo', 'checklist', 'تودو'] }
      ),
      new StudioMenuOption(
        'Toggle',
        'card',
        <ChevronRight size={14} color="#64748b" />,
        'Hide or show collapsible text',
        { cardType: 'toggle', badge: <span style={{ fontSize: '10px' }}>▶</span>, keywords: ['طي', 'أكورديون', 'منسدل', 'toggle', 'accordion'] }
      ),
      new StudioMenuOption(
        'Callout',
        'card',
        <MessageSquare size={14} color="#16a34a" />,
        'Make writing stand out with an alert box',
        { cardType: 'callout', badge: <MessageSquare size={12} color="#16a34a" />, keywords: ['تنبيه', 'ملاحظة', 'إشعار', 'callout', 'note', 'alert'] }
      ),
      new StudioMenuOption(
        'Button',
        'card',
        <MousePointerClick size={14} color="#2563eb" />,
        'Add a clickable call-to-action button',
        { cardType: 'button', badge: <MousePointerClick size={12} color="#2563eb" />, keywords: ['زر', 'زر تفاعلي', 'button', 'cta'] }
      ),
      new StudioMenuOption(
        'Markdown',
        'card',
        <Code2 size={14} color="#475569" />,
        'Insert raw markdown block',
        { cardType: 'markdown', badge: <span style={{ fontSize: '9px', fontWeight: 700 }}>M↓</span>, keywords: ['ماركداون', 'markdown', 'md'] }
      ),
      new StudioMenuOption(
        'HTML',
        'card',
        <Code size={14} color="#e11d48" />,
        'Insert raw custom HTML',
        { cardType: 'html', badge: <span style={{ fontFamily: 'monospace', fontSize: '9px', fontWeight: 700, color: '#e11d48' }}>&lt;&gt;</span>, keywords: ['اتش تي ام ال', 'html', 'raw'] }
      ),

      // Column 3: Rich Media & Embeds
      new StudioMenuOption(
        'Image',
        'card',
        <ImageIcon size={14} color="#0284c7" />,
        'Upload or embed with image card',
        { cardType: 'image', badge: <ImageIcon size={12} color="#0284c7" />, keywords: ['صورة', 'image', 'picture', 'photo', 'رسم'] }
      ),
      new StudioMenuOption(
        'Gallery',
        'card',
        <Images size={14} color="#0284c7" />,
        'Create an image grid or gallery',
        { cardType: 'gallery', badge: <Images size={12} color="#0284c7" />, keywords: ['معرض', 'معرض صور', 'gallery', 'صور'] }
      ),
      new StudioMenuOption(
        'Video',
        'card',
        <Video size={14} color="#dc2626" />,
        'Embed or upload a video clip',
        { cardType: 'video', badge: <Video size={12} color="#dc2626" />, keywords: ['فيديو', 'مقطع', 'مرئي', 'video', 'movie'] }
      ),
      new StudioMenuOption(
        'Audio',
        'card',
        <Box size={14} color="#ea580c" />,
        'Upload an audio file or podcast track',
        { cardType: 'audio', badge: <Box size={12} color="#ea580c" />, keywords: ['صوت', 'تسجيل', 'بودكاست', 'audio', 'podcast', 'sound'] }
      ),
      new StudioMenuOption(
        'File',
        'card',
        <FileIcon size={14} color="#d97706" />,
        'Upload a downloadable document or asset',
        { cardType: 'file', badge: <FileIcon size={12} color="#d97706" />, keywords: ['ملف', 'مستند', 'تحميل', 'file', 'document', 'download'] }
      ),
      new StudioMenuOption(
        'Bookmark',
        'card',
        <Bookmark size={14} color="#4f46e5" />,
        'Embed a web link with rich preview card',
        { cardType: 'bookmark', badge: <Bookmark size={12} color="#4f46e5" />, keywords: ['رابط', 'مرجع', 'موقع', 'bookmark', 'link'] }
      ),
      new StudioMenuOption(
        'Embed',
        'card',
        <Layers size={14} color="#7c3aed" />,
        'Embed YouTube, Vimeo, Spotify, or Twitter',
        { cardType: 'embed', badge: <Layers size={12} color="#7c3aed" />, keywords: ['تضمين', 'يوتيوب', 'embed', 'youtube', 'vimeo'] }
      ),
    ];
  }, []);

  const options = useMemo(
    () => filterSlashMenuOptions(baseOptions, queryString),
    [baseOptions, queryString]
  );

  const onSelectOption = useCallback(
    (selectedOption: StudioMenuOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      let insertedKey: string | null = null;
      const cardType = selectedOption.cardType;
      const actionType = selectedOption.actionType;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selectedOption == null) {
          return;
        }

        if (nodeToRemove) {
          nodeToRemove.remove();
        }

        if (actionType) {
          switch (actionType) {
            case 'paragraph': {
              const p = $createParagraphNode();
              selection.insertNodes([p]);
              break;
            }
            case 'h1':
            case 'h2':
            case 'h3': {
              const h = $createHeadingNode(actionType);
              selection.insertNodes([h]);
              break;
            }
            case 'check-list': {
              const list = $createListNode('check');
              const item = $createListItemNode();
              list.append(item);
              selection.insertNodes([list]);
              item.select();
              break;
            }
            case 'table': {
              const table = $createTableNodeWithDimensions(3, 3, true);
              selection.insertNodes([table]);
              break;
            }
            case 'bullet-list': {
              const list = $createListNode('bullet');
              const item = $createListItemNode();
              list.append(item);
              selection.insertNodes([list]);
              item.select();
              break;
            }
            case 'number-list': {
              const list = $createListNode('number');
              const item = $createListItemNode();
              list.append(item);
              selection.insertNodes([list]);
              item.select();
              break;
            }
            case 'quote': {
              const q = $createQuoteNode();
              selection.insertNodes([q]);
              break;
            }
            case 'code': {
              const c = $createCodeNode();
              selection.insertNodes([c]);
              break;
            }
          }
        } else if (cardType) {
          const cardNode = $createReactStudioCardNode(cardType, {});
          selection.insertNodes([cardNode]);
          insertedKey = cardNode.getKey();
        }
      });

      closeMenu();
      setMediaError(false);

      const MEDIA_CARD_TYPES = new Set(['image', 'gallery', 'video', 'audio', 'file']);
      if (cardType && MEDIA_CARD_TYPES.has(cardType) && requestMedia) {
        // Normalize synchronous throws and rejected promises without leaking
        // provider errors or replacing author edits made while it was pending.
        Promise.resolve()
          .then(() => requestMedia({ cardType }))
          .then((payload) => {
            if (!payload || insertedKey === null) return;
            // Lexical editor.update is scheduled: capture the key only after
            // its insert callback has executed, never immediately after update().
            const nodeKey = insertedKey;
            editor.update(() => {
              const node = $getNodeByKey(nodeKey);
              if (!$isReactStudioCardNode(node)) return; // Card was removed.
              const next = { ...node.getCardData() };
              for (const [name, value] of Object.entries(payload)) {
                if (name === '__proto__' || name === 'constructor' || name === 'prototype') continue;
                if (!Object.prototype.hasOwnProperty.call(next, name) ||
                    next[name] === null || next[name] === '') {
                  next[name] = value;
                }
              }
              node.setCardData(next);
            });
          })
          .catch(() => setMediaError(true));
      }
    },
    [editor, requestMedia]
  );

  return (
    <>
    <LexicalTypeaheadMenuPlugin<StudioMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (anchorElementRef.current == null || (options.length === 0 && !queryString)) {
          return null;
        }

        return createPortal(
          <SlashMenuPortalContent
            anchorElement={anchorElementRef.current}
            options={options}
            selectedIndex={selectedIndex}
            selectOptionAndCleanUp={selectOptionAndCleanUp}
            setHighlightedIndex={setHighlightedIndex}
            queryString={queryString}
          />,
          anchorElementRef.current
        );
      }}
    />
    {mediaError && (
      <div role="alert" className="my-2 text-sm text-red-700">
        Media selection failed. You can upload directly from the inserted card.
        <button type="button" className="mx-2 underline" onClick={() => setMediaError(false)}>Dismiss</button>
      </div>
    )}
    </>
  );
}
