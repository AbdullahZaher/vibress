import { Page, CreatePageData, ListPagesFilter } from "./page";

export interface PageRepository {
  findById(id: string): Promise<Page | null>;
  findBySlug(slug: string): Promise<Page | null>;
  findPublishedBySlug(slug: string): Promise<Page | null>;
  create(
    data: CreatePageData & { slug: string; content: Record<string, unknown> },
  ): Promise<Page>;
  update(id: string, data: Partial<Page> & { version: number }): Promise<Page>;
  delete(id: string): Promise<void>;
  list(filter?: ListPagesFilter): Promise<{ pages: Page[]; total: number }>;
  findDueScheduledPages(now?: Date): Promise<Page[]>;
}
