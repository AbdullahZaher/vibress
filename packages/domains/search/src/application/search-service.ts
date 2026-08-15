import {
  SearchRepository,
  SearchDocumentInput,
  SearchResult,
} from "../domain/search";
import { domainEvents } from "@vibress/events";

export class SearchDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_QUERY_LENGTH = 100;

/**
 * Sanitizes a search query: bounded length, no pathological wildcards.
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
  return cleaned;
}

export interface ContentSource {
  listIndexableContent(): Promise<SearchDocumentInput[]>;
}

export class SearchService {
  constructor(private repo: SearchRepository) {}

  async search(
    q: string,
    limit = 20,
    offset = 0,
  ): Promise<{ results: SearchResult[]; total: number }> {
    const sanitized = sanitizeSearchQuery(q);
    return this.repo.query(
      sanitized,
      Math.min(Math.max(limit, 1), 50),
      Math.max(offset, 0),
    );
  }

  async indexDocument(doc: SearchDocumentInput): Promise<void> {
    if (!doc.title.trim()) return;
    await this.repo.upsert(doc);
    domainEvents.emit("search.indexed", {
      entityType: doc.entityType,
      entityId: doc.entityId,
    });
  }

  async removeDocument(entityType: string, entityId: string): Promise<void> {
    await this.repo.remove(entityType, entityId);
    domainEvents.emit("search.removed", { entityType, entityId });
  }

  /**
   * Full index rebuild: clears the index and re-indexes all indexable
   * content. Only searchable (published, public) content is indexed.
   */
  async rebuild(source: ContentSource): Promise<number> {
    await this.repo.clear();
    const docs = await source.listIndexableContent();
    let indexed = 0;
    for (const doc of docs) {
      await this.repo.upsert(doc);
      indexed++;
    }
    return indexed;
  }

  async indexCount(): Promise<number> {
    return this.repo.count();
  }
}
