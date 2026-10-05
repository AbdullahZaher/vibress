import { Author } from "./author";

export interface AuthorRepository {
  getPostAuthors(postId: string): Promise<Author[]>;
  findMissingPublicationAuthorIds(
    publicationId: string,
    authorIds: string[],
  ): Promise<string[]>;
  setPostAuthors(
    postId: string,
    authorIds: string[],
    primaryAuthorId: string,
    publicationId: string,
  ): Promise<void>;
  getPageAuthors(pageId: string): Promise<Author[]>;
  setPageAuthors(
    pageId: string,
    authorIds: string[],
    primaryAuthorId: string,
    publicationId: string,
  ): Promise<void>;
  findAuthorBySlug(
    slug: string,
  ): Promise<{
    id: string;
    name: string;
    slug: string;
    bio: string | null;
  } | null>;
  listAuthors(): Promise<
    Array<{ id: string; name: string; slug: string; bio: string | null }>
  >;
}
