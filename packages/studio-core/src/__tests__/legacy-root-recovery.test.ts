import { describe, expect, it } from 'vitest';
import { migrateDocument, StudioMigrationError, validateStudioDocument } from '../index';

const children = [{
  type: 'paragraph', version: 1, direction: 'rtl', format: '', indent: 0,
  children: [{ type: 'text', version: 1, text: 'مسودة English', format: 1, detail: 0, mode: 'normal', style: '' }],
}];

describe('historical root compatibility and recoverable validation', () => {
  it.each([false, true])('restores only the missing root discriminator (envelope=%s)', enveloped => {
    const root = { children, direction: 'rtl', extension: { keep: true } };
    const original = enveloped ? { schema: 'vibress-studio', version: 1, root } : { version: 1, root };
    const before = JSON.stringify(original);
    const document = migrateDocument(original);
    expect(document.root).toEqual({ ...root, type: 'root' });
    expect(JSON.stringify(original)).toBe(before);
    expect(migrateDocument(JSON.stringify(original))).toEqual(document);
    expect(migrateDocument(JSON.stringify(document))).toEqual(document);
  });

  it.each([false, true])('loads the historical empty root without discarding content (envelope=%s)', enveloped => {
    const original = enveloped ? { schema: 'vibress-studio', version: 1, root: {} } : { version: 1, root: {} };
    expect(migrateDocument(original).root).toEqual({ type: 'root', children: [] });
    expect(original.root).toEqual({});
  });

  it('normalizes legacy cards while preserving all payload fields', () => {
    const cardData = { src: '/media/image.png', assetId: 'asset-1', caption: 'وصف English', extra: { retain: true } };
    const document = migrateDocument({ root: { children: [{ type: 'react-studio-card', cardType: 'image', cardData, version: 1 }] } });
    expect(document.root.children[0]).toMatchObject({ type: 'studio-card', cardData });
  });

  it.each([
    { type: 'paragraph', children },
    { type: null, children },
    { type: '', children },
    { children: 'unreadable structure' },
    { text: 'Do not replace this content with an empty root' },
    { root: { type: 'root', children } },
  ])('retains ambiguous roots in typed recovery errors %#', root => {
    const original = { version: 1, root };
    for (const input of [original, JSON.stringify(original)]) {
      try {
        migrateDocument(input);
        expect.unreachable('Expected a recoverable validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(StudioMigrationError);
        if (error instanceof StudioMigrationError) {
          expect(error.code).toBe('INVALID_DOCUMENT');
          expect(error.rawDocument).toBe(input);
        }
      }
    }
  });

  it('keeps direct validation strict and errors recoverable', () => {
    const original = { schema: 'vibress-studio', version: 1, root: { children } };
    try {
      validateStudioDocument(original);
      expect.unreachable('Direct validation must not infer a missing discriminator');
    } catch (error) {
      expect(error).toBeInstanceOf(StudioMigrationError);
      if (error instanceof StudioMigrationError) expect(error.rawDocument).toBe(original);
    }
  });

  it('retains invalid canonical JSON bytes in the recovery error', () => {
    const original = JSON.stringify({ schema: 'vibress-studio', version: 1, root: { type: 'paragraph', children } });
    try {
      migrateDocument(original);
      expect.unreachable('Expected recovery');
    } catch (error) {
      expect(error).toBeInstanceOf(StudioMigrationError);
      if (error instanceof StudioMigrationError) expect(error.rawDocument).toBe(original);
    }
  });

  it('never repairs a foreign schema into a Studio document', () => {
    const original = { schema: 'foreign-editor', version: 1, root: { children } };
    expect(() => migrateDocument(original)).toThrow(StudioMigrationError);
  });

  it('enforces the size budget after adding missing structural fields', () => {
    const original = { schema: 'vibress-studio', version: 1, root: {} };
    const maxSizeBytes = JSON.stringify(original).length;
    try {
      migrateDocument(original, { maxSizeBytes });
      expect.unreachable('The repaired envelope exceeds this exact input-only budget');
    } catch (error) {
      expect(error).toBeInstanceOf(StudioMigrationError);
      if (error instanceof StudioMigrationError) {
        expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');
        expect(error.rawDocument).toBe(original);
      }
    }
  });
});
