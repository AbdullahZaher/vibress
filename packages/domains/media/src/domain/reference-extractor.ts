export interface ExtractedMediaReference {
  mediaId: string;
  fieldPath: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_URL_KEY_REGEX = /\/content\/media\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;
const MEDIA_URL_SIMPLE_REGEX = /\/content\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export function extractMediaReferencesFromDocument(doc: unknown): ExtractedMediaReference[] {
  if (!doc || typeof doc !== 'object') {
    return [];
  }

  const results: ExtractedMediaReference[] = [];
  const visited = new Set<unknown>();

  function traverse(obj: unknown, path: string) {
    if (!obj || typeof obj !== 'object' || visited.has(obj)) {
      return;
    }
    visited.add(obj);

    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => traverse(item, `${path}[${idx}]`));
      return;
    }

    const record = obj as Record<string, unknown>;
    let foundExplicitAssetId: string | null = null;

    // Check direct assetId field
    if (typeof record.assetId === 'string' && record.assetId.trim()) {
      const assetId = record.assetId.trim();
      if (UUID_REGEX.test(assetId)) {
        foundExplicitAssetId = assetId;
        results.push({ mediaId: assetId, fieldPath: path || 'root' });
      }
    }

    // Check assetIds array (gallery cards)
    if (Array.isArray(record.assetIds)) {
      for (const entry of record.assetIds) {
        const assetId = typeof entry === 'string' ? entry.trim() : '';
        if (assetId && UUID_REGEX.test(assetId)) {
          results.push({ mediaId: assetId, fieldPath: path || 'root' });
        }
      }
    }

    // Check src or url properties for embedded media keys if explicit assetId was not found
    for (const key of ['src', 'url']) {
      if (typeof record[key] === 'string') {
        const val = record[key] as string;
        const matchKey = val.match(MEDIA_URL_KEY_REGEX) || val.match(MEDIA_URL_SIMPLE_REGEX);
        if (matchKey && matchKey[1]) {
          const matchedId = matchKey[1];
          if (matchedId !== foundExplicitAssetId) {
            results.push({ mediaId: matchedId, fieldPath: path ? `${path}.${key}` : key });
          }
        }
      }
    }

    // Traverse children and properties
    for (const [k, v] of Object.entries(record)) {
      if (v && typeof v === 'object') {
        traverse(v, path ? `${path}.${k}` : k);
      }
    }
  }

  traverse(doc, '');

  // Deduplicate by mediaId + fieldPath
  const uniqueMap = new Map<string, ExtractedMediaReference>();
  for (const ref of results) {
    const key = `${ref.mediaId}:${ref.fieldPath}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, ref);
    }
  }

  return Array.from(uniqueMap.values());
}
