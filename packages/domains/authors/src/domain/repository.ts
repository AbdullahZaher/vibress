import { Author } from './author';

export interface AuthorRepository {
  getPostAuthors(postId: string): Promise<Author[]>;
  setPostAuthors(postId: string, authorIds: string[], primaryAuthorId: string): Promise<void>;
  getPageAuthors(pageId: string): Promise<Author[]>;
  setPageAuthors(pageId: string, authorIds: string[], primaryAuthorId: string): Promise<void>;
  findAuthorBySlug(slug: string): Promise<{ id: string; name: string; slug: string; bio: string | null } | null>;
  listAuthors(): Promise<Array<{ id: string; name: string; slug: string; bio: string | null }>>;
}
