import { AuthorRepository } from '../domain/repository';
import { Author } from '../domain/author';

export class AuthorsService {
  constructor(private authorRepo: AuthorRepository) {}

  async getPostAuthors(postId: string): Promise<Author[]> {
    return this.authorRepo.getPostAuthors(postId);
  }

  async setPostAuthors(postId: string, authorIds: string[], primaryAuthorId: string): Promise<void> {
    await this.authorRepo.setPostAuthors(postId, authorIds, primaryAuthorId);
  }

  async getPageAuthors(pageId: string): Promise<Author[]> {
    return this.authorRepo.getPageAuthors(pageId);
  }

  async setPageAuthors(pageId: string, authorIds: string[], primaryAuthorId: string): Promise<void> {
    await this.authorRepo.setPageAuthors(pageId, authorIds, primaryAuthorId);
  }
}
