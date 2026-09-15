export type SearchEntityType = "post" | "page" | "tag" | "author";

export interface SearchDocument {
  id: string;
  publicationId: string;
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
  publicationId?: string | undefined;
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  bodyText?: string | undefined;
  slug?: string | undefined;
  url?: string | undefined;
}

export interface SearchRepository {
  upsert(doc: SearchDocumentInput & { publicationId?: string | undefined }): Promise<void>;
  remove(entityType: string, entityId: string, publicationId?: string): Promise<void>;
  setSearchable(
    entityType: string,
    entityId: string,
    searchable: boolean,
    publicationId?: string,
  ): Promise<void>;
  query(
    q: string,
    limit: number,
    offset: number,
    publicationId?: string,
  ): Promise<{ results: SearchResult[]; total: number }>;
  count(publicationId?: string): Promise<number>;
  clear(publicationId?: string): Promise<void>;
}
