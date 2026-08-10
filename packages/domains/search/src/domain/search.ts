export type SearchEntityType = 'post' | 'page' | 'tag' | 'author';

export interface SearchDocument {
  id: string;
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  bodyText: string;
  slug: string;
  url: string;
  searchable: boolean;
  updatedAt: Date;
}

export interface SearchResult {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  excerpt: string;
  url: string;
}

export interface SearchDocumentInput {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  bodyText?: string | undefined;
  slug?: string | undefined;
  url?: string | undefined;
}

export interface SearchRepository {
  upsert(doc: SearchDocumentInput): Promise<void>;
  remove(entityType: string, entityId: string): Promise<void>;
  setSearchable(entityType: string, entityId: string, searchable: boolean): Promise<void>;
  query(q: string, limit: number, offset: number): Promise<{ results: SearchResult[]; total: number }>;
  count(): Promise<number>;
  clear(): Promise<void>;
}
