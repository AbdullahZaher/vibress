import { describe, it, expect } from 'vitest';
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $isTextNode,
} from 'lexical';
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text';
import { StudioCardNode } from '@vibress/studio-cards';
import { ReactStudioCardNode } from '../nodes/ReactStudioCardNode';
import { $deepCloneNode } from '../utils/cloneNode';

describe('Block Duplication & $deepCloneNode (STU-002)', () => {
  it('deep clones a paragraph with nested formatted text nodes', () => {
    const editor = createEditor({
      nodes: [HeadingNode, StudioCardNode, ReactStudioCardNode],
    });

    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const t1 = $createTextNode('Plain text and ');
        const t2 = $createTextNode('bold colored text');
        t2.setFormat(1); // bold
        t2.setStyle('color: #1d4ed8; background-color: #dbeafe;');
        p.append(t1, t2);
        root.append(p);

        const cloned = $deepCloneNode(p);

        expect($isElementNode(cloned)).toBe(true);
        expect(cloned.getType()).toBe('paragraph');

        const children = (cloned as typeof p).getChildren();
        expect(children.length).toBe(2);
        const first = children[0];
        const second = children[1];
        expect(first?.getTextContent()).toBe('Plain text and ');
        expect(second?.getTextContent()).toBe('bold colored text');
        expect(second && $isTextNode(second) && second.getFormat()).toBe(1);
        expect(second && $isTextNode(second) && second.getStyle()).toContain('color: #1d4ed8');

        // Verify it was appended after original without altering root count initially
        p.insertAfter(cloned);
        expect(root.getChildren().length).toBe(2);
      },
      { discrete: true }
    );
  });

  it('deep clones a heading node preserving its tag and children', () => {
    const editor = createEditor({
      nodes: [HeadingNode, StudioCardNode, ReactStudioCardNode],
    });

    editor.update(
      () => {
        const root = $getRoot();
        const h1 = $createHeadingNode('h1');
        const text = $createTextNode('Title of Article');
        h1.append(text);
        root.append(h1);

        const cloned = $deepCloneNode(h1);

        expect(cloned.getType()).toBe('heading');
        expect((cloned as HeadingNode).getTag()).toBe('h1');
        expect(cloned.getTextContent()).toBe('Title of Article');
      },
      { discrete: true }
    );
  });

  it('deep clones a StudioCardNode preserving cardType and full cardData payload', () => {
    const editor = createEditor({
      nodes: [HeadingNode, StudioCardNode, ReactStudioCardNode],
    });

    editor.update(
      () => {
        const root = $getRoot();
        const cardData = {
          src: 'https://images.unsplash.com/photo-1234',
          alt: 'Sunset over ocean',
          caption: 'Beautiful scenic view',
          width: 'wide',
          assetId: 'asset_99',
        };
        const card = new ReactStudioCardNode('image', cardData);
        root.append(card);

        const cloned = $deepCloneNode(card);

        expect(cloned).toBeInstanceOf(StudioCardNode);
        expect((cloned as StudioCardNode).getCardType()).toBe('image');
        expect((cloned as StudioCardNode).getCardData()).toEqual(cardData);

        // Crucial test: verify it is NOT an empty paragraph
        expect(cloned.getType()).not.toBe('paragraph');
        expect((cloned as StudioCardNode).getCardData()).not.toBeNull();
      },
      { discrete: true }
    );
  });
});
