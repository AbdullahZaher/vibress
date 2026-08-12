import { Post, CreatePostData, UpdatePostData, ListPostsFilter, PostStatus } from './post';

export interface PostRepository {
  findById(id: string): Promise<Post | null>;
  findBySlug(slug: string): Promise<Post | null>;
  findPublishedBySlug(slug: string): Promise<Post | null>;
  create(data: CreatePostData & { slug: string; content: Record<string, unknown> }): Promise<Post>;
  update(id: string, data: Partial<Post> & { version: number }): Promise<Post>;
  delete(id: string): Promise<void>;
  list(filter?: ListPostsFilter): Promise<{ posts: Post[]; total: number }>;
  findDueScheduledPosts(now?: Date): Promise<Post[]>;

  // Tag relations
  getPostTagIds(postId: string): Promise<string[]>;
  setPostTagIds(postId: string, tagIds: string[]): Promise<void>;
}
