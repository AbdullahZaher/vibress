import { describe, it, expect } from 'vitest';
import {
  normalizeStudioDocument,
  migrateDocument,
  CANONICAL_CARD_NODE_TYPE,
  LEGACY_CARD_NODE_TYPE,
  createEmptyStudioDocument,
} from '../index';

describe('normalizeStudioDocument (canonical card serialization)', () => {
  it('converts legacy react-studio-card nodes to canonical studio-card', () => {
    const legacy = {
      schema: 'vibress-studio',
      version: 1,
      root: {
        type: 'root',
        children: [
          {
            type: LEGACY_CARD_NODE_TYPE,
            cardType: 'image',
            cardData: { assetId: 'a-1', src: '/x.png', alt: 'dp' },
            version: 1,
          },
        ],
      },
    };
    const normalized = normalizeStudioDocument(legacy);
    const node = (normalized as any).root.children[0];
    expect(node.type).toBe(CANONICAL_CARD_NODE_TYPE);
    expect(node.cardType).toBe('image');
    expect(node.cardData).toEqual({ assetId: 'a-1', src: '/x.png', alt: 'dp' });
    expect(node.version).toBe(1);
  });

  it('preserves nested structures recursively (cards inside paragraphs)', () => {
    const legacy = {
      schema: 'vibress-studio',
      version: 1,
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'before ', format: 0, mode: 'normal', version: 1 },
              {
                type: LEGACY_CARD_NODE_TYPE,
                cardType: 'video',
                cardData: { assetId: 'v-9', src: '/v.mp4' },
                version: 1,
              },
            ],
            version: 1,
          },
        ],
      },
    };
    const normalized = normalizeStudioDocument(legacy);
    const paragraph = (normalized as any).root.children[0];
    const card = paragraph.children[1];
    expect(card.type).toBe(CANONICAL_CARD_NODE_TYPE);
    expect(card.cardData.assetId).toBe('v-9');
    expect(paragraph.children[0].text).toBe('before ');
  });

  it('leaves canonical documents unchanged', () => {
    const canonical = {
      schema: 'vibress-studio',
      version: 1,
      root: {
        type: 'root',
        children: [
          { type: CANONICAL_CARD_NODE_TYPE, cardType: 'divider', cardData: {}, version: 1 },
          { type: 'paragraph', children: [{ type: 'text', text: 'hi', format: 0, mode: 'normal', version: 1 }], version: 1 },
        ],
      },
    };
    expect(normalizeStudioDocument(canonical)).toEqual(canonical);
  });

  it('does not mutate the input document', () => {
    const legacy = {
      schema: 'vibress-studio',
      version: 1,
      root: {
        type: 'root',
        children: [{ type: LEGACY_CARD_NODE_TYPE, cardType: 'image', cardData: {}, version: 1 }],
      },
    };
    const snapshot = JSON.stringify(legacy);
    normalizeStudioDocument(legacy);
    expect(JSON.stringify(legacy)).toBe(snapshot);
  });

  it('migrateDocument normalizes legacy card nodes at read time', () => {
    const legacy = {
      schema: 'vibress-studio',
      version: 1,
      root: {
        type: 'root',
        children: [
          { type: LEGACY_CARD_NODE_TYPE, cardType: 'button', cardData: { text: 'Buy', url: 'https://x.com' }, version: 1 },
        ],
      },
    };
    const migrated = migrateDocument(legacy);
    const node = (migrated as any).root.children[0];
    expect(node.type).toBe(CANONICAL_CARD_NODE_TYPE);
    expect(node.cardType).toBe('button');
  });

  it('migrateDocument still supports legacy string and {text} documents', () => {
    expect((migrateDocument('plain legacy string') as any).root.children.length).toBeGreaterThan(0);
    const textDoc = migrateDocument({ text: 'legacy batch 2' });
    expect((textDoc as any).schema).toBe('vibress-studio');
    expect(createEmptyStudioDocument().root.type).toBe('root');
  });
});
