import { Post, CreatePostData, ListPostsFilter } from "./post";

export interface PostRepository {
  findById(id: string, publicationId?: string): Promise<Post | null>;
  findBySlug(slug: string, publicationId?: string): Promise<Post | null>;
  findPublishedBySlug(slug: string, publicationId?: string): Promise<Post | null>;
  create(
    data: CreatePostData & { slug: string; content: Record<string, unknown>; publicationId?: string },
  ): Promise<Post>;
  update(
    id: string,
    data: Partial<Post> & { version: number },
    publicationId?: string,
  ): Promise<Post>;
  delete(id: string, publicationId?: string): Promise<void>;
  list(filter?: ListPostsFilter): Promise<{ posts: Post[]; total: number }>;
  findDueScheduledPosts(now?: Date, publicationId?: string): Promise<Post[]>;

  // Tag relations
  getPostTagIds(postId: string): Promise<string[]>;
  setPostTagIds(postId: string, tagIds: string[]): Promise<void>;
}
