import { AuthorRepository } from "../domain/repository";
import { Author } from "../domain/author";

export class AuthorsService {
  constructor(private authorRepo: AuthorRepository) {}

  async getPostAuthors(postId: string): Promise<Author[]> {
    return this.authorRepo.getPostAuthors(postId);
  }

  async setPostAuthors(
    postId: string,
    authorIds: string[],
    primaryAuthorId: string,
    publicationId: string,
  ): Promise<void> {
    await this.authorRepo.setPostAuthors(
      postId,
      authorIds,
      primaryAuthorId,
      publicationId,
    );
  }

  async getPageAuthors(pageId: string): Promise<Author[]> {
    return this.authorRepo.getPageAuthors(pageId);
  }

  async setPageAuthors(
    pageId: string,
    authorIds: string[],
    primaryAuthorId: string,
    publicationId: string,
  ): Promise<void> {
    await this.authorRepo.setPageAuthors(
      pageId,
      authorIds,
      primaryAuthorId,
      publicationId,
    );
  }

  async findAuthorBySlug(
    slug: string,
    publicationId?: string,
  ): Promise<{
    id: string;
    name: string;
    slug: string;
    bio: string | null;
  } | null> {
    return this.authorRepo.findAuthorBySlug(slug, publicationId);
  }

  async listAuthors(
    publicationId?: string,
  ): Promise<
    Array<{ id: string; name: string; slug: string; bio: string | null }>
  > {
    return this.authorRepo.listAuthors(publicationId);
  }
}
