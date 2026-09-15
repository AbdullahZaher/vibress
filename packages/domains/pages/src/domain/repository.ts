import { Page, CreatePageData, ListPagesFilter } from "./page";

export interface PageRepository {
  findById(id: string, publicationId?: string): Promise<Page | null>;
  findBySlug(slug: string, publicationId?: string): Promise<Page | null>;
  findPublishedBySlug(slug: string, publicationId?: string): Promise<Page | null>;
  create(
    data: CreatePageData & { slug: string; content: Record<string, unknown>; publicationId?: string },
  ): Promise<Page>;
  update(id: string, data: Partial<Page> & { version: number }, publicationId?: string): Promise<Page>;
  delete(id: string, publicationId?: string): Promise<void>;
  list(filter?: ListPagesFilter): Promise<{ pages: Page[]; total: number }>;
  findDueScheduledPages(now?: Date, publicationId?: string): Promise<Page[]>;
}
