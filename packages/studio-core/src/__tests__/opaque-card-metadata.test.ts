import { expect, it } from 'vitest';
import { createDefaultStudioDocument, migrateDocument } from '../index';

it.each(['studio-card', 'react-studio-card'])('preserves opaque %s payloads through normalization and reload', (type) => {
  const cardData = { src: '/media/image.jpg', alt: 'Arabic صورة', extension: { type: 'react-studio-card', custom: 'opaque' } };
  const value = createDefaultStudioDocument('Keep author text');
  value.root.children.push({ type, version: 1, cardType: 'image', cardData });
  const before = JSON.stringify(value);
  const migrated = migrateDocument(value);
  expect(migrated.root.children.at(-1)).toEqual({ type: 'studio-card', version: 1, cardType: 'image', cardData });
  expect(migrateDocument(JSON.stringify(migrated))).toEqual(migrated);
  expect(JSON.stringify(value)).toBe(before);
});
it('preserves unknown node metadata while normalizing actual child nodes', () => {
  const value = createDefaultStudioDocument('Keep text');
  value.root.futureMetadata = { type: 'react-studio-card', custom: 'opaque root metadata' };
  expect(migrateDocument(value)).toEqual(value);
});
