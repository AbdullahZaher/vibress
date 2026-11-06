import { expect, it } from 'vitest';
import { assertStudioDocumentEditable, createDefaultStudioDocument, migrateDocument } from '../index';

it.each([1, 2, 3, 4, 5, 6])('recovers numeric element alignment %s rather than letting Lexical discard it', (format) => {
  const value = createDefaultStudioDocument('Keep alignment');
  value.root.format = format;
  expect(migrateDocument(value)).toEqual(value);
  expect(() => assertStudioDocumentEditable(value)).toThrow();
});
it.each([0, '', 'center', 'right'])('accepts supported element alignment/default %s', (format) => {
  const value = createDefaultStudioDocument('Keep alignment');
  value.root.format = format;
  expect(() => assertStudioDocumentEditable(value)).not.toThrow();
});
