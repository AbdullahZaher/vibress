import { expect, it } from 'vitest';
import { createDefaultStudioDocument } from '@vibress/studio-core';
import { serializeStudioDocument } from '../index';

it.each(['root', 'source'] as const)('rejects %s accessors before executing them', (target) => {
  const source = createDefaultStudioDocument('Author content');
  const root = createDefaultStudioDocument('Current draft').root;
  let reads = 0;
  Object.defineProperty(target === 'root' ? root : source, target === 'root' ? 'type' : 'version', {
    enumerable: true,
    get() { reads++; return target === 'root' ? 'root' : 1; },
  });
  expect(() => serializeStudioDocument(root, undefined, source)).toThrow();
  expect(reads).toBe(0);
});
