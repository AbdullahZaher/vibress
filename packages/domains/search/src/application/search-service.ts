import {
  SearchRepository,
  SearchDocumentInput,
  SearchResult,
} from "../domain/search";
import { normalizeArabicText, isArabicText } from "../domain/arabic-normalizer";
import { domainEvents } from "@vibress/events";

export class SearchDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_QUERY_LENGTH = 100;

export interface SearchTelemetry {
  query: string;
  totalResults: number;
  durationMs: number;
  isZeroResult: boolean;
  timestamp: string;
}

/**
 * Sanitizes a search query: bounded length, no pathological wildcards,
 * and normalizes Arabic script if present.
 */
export function sanitizeSearchQuery(q: string): string {
  const trimmed = q.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new SearchDomainError(
      "QUERY_TOO_LONG",
      `Query exceeds ${MAX_QUERY_LENGTH} characters`,
    );
  }
  // Normalize whitespace, strip control characters (charCodeAt loop), collapse spaces
  let cleaned = "";
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 32 || code === 127) {
      cleaned += " ";
      continue;
    }
    cleaned += trimmed[i];
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new SearchDomainError("EMPTY_QUERY", "Query is empty");
  }
  // A query made only of wildcards is pathological
  if (/^[*%_]+$/.test(cleaned)) {
    throw new SearchDomainError("INVALID_QUERY", "Invalid query");
  }

  // Normalize Arabic forms if query contains Arabic text
  if (isArabicText(cleaned)) {
    cleaned = normalizeArabicText(cleaned);
  }

  return cleaned;
}

export interface ContentSource {
  listIndexableContent(publicationId?: string): Promise<SearchDocumentInput[]>;
}

export class SearchService {
  constructor(private repo: SearchRepository) {}

  async search(
    q: string,
    limit = 20,
    offset = 0,
    publicationId?: string,
  ): Promise<{ results: SearchResult[]; total: number }> {
    const start = performance.now();
    const sanitized = sanitizeSearchQuery(q);
    const result = publicationId
      ? await this.repo.query(
          sanitized,
          Math.min(Math.max(limit, 1), 50),
          Math.max(offset, 0),
          publicationId,
        )
      : await this.repo.query(
          sanitized,
          Math.min(Math.max(limit, 1), 50),
          Math.max(offset, 0),
        );
    const durationMs = Math.round(performance.now() - start);

    domainEvents.emit("search.queried", {
      query: sanitized,
      totalResults: result.total,
      durationMs,
      isZeroResult: result.total === 0,
      timestamp: new Date().toISOString(),
      publicationId,
    });

    return result;
  }

  async indexDocument(doc: SearchDocumentInput, publicationId?: string): Promise<void> {
    if (!doc.title.trim()) return;

    const pubId = publicationId || doc.publicationId || "pub_default";

    // Normalize Arabic text in title and bodyText for high-recall index matching
    const normalizedDoc: SearchDocumentInput = {
      ...doc,
      publicationId: pubId,
      title: isArabicText(doc.title) ? normalizeArabicText(doc.title) : doc.title,
      bodyText: doc.bodyText && isArabicText(doc.bodyText) ? normalizeArabicText(doc.bodyText) : doc.bodyText,
    };

    await this.repo.upsert(normalizedDoc);
    domainEvents.emit("search.indexed", {
      entityType: doc.entityType,
      entityId: doc.entityId,
      publicationId: pubId,
    });
  }

  async removeDocument(entityType: string, entityId: string, publicationId?: string): Promise<void> {
    await this.repo.remove(entityType, entityId, publicationId);
    domainEvents.emit("search.removed", { entityType, entityId, publicationId });
  }

  /**
   * Full index rebuild: clears the index for the publication and re-indexes all indexable
   * content. Only searchable (published, public) content is indexed.
   */
  async rebuild(source: ContentSource, publicationId?: string): Promise<number> {
    await this.repo.clear(publicationId);
    const docs = await source.listIndexableContent(publicationId);
    let indexed = 0;
    for (const doc of docs) {
      await this.indexDocument(doc, publicationId);
      indexed++;
    }
    return indexed;
  }

  async indexCount(publicationId?: string): Promise<number> {
    return this.repo.count(publicationId);
  }
}
