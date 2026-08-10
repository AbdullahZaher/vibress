import { PostRepository } from '../domain/repository';
import { Post, CreatePostData, UpdatePostData, ListPostsFilter } from '../domain/post';
import { RevisionsService } from '@vibress/revisions';
import { AuthorRepository } from '@vibress/authors';
import { AuditRepository } from '@vibress/audit';
import { extractMediaReferencesFromDocument, MediaService } from '@vibress/media';
import { generateUniqueSlug } from '@vibress/utils';
import { domainEvents } from '@vibress/events';

export class PostsService {
  constructor(
    private postRepo: PostRepository,
    private revisionService: RevisionsService,
    private authorRepo: AuthorRepository,
    private auditRepo: AuditRepository,
    private mediaService?: MediaService
  ) {}

  async findById(id: string): Promise<Post | null> {
    return this.postRepo.findById(id);
  }

  async findBySlug(slug: string): Promise<Post | null> {
    return this.postRepo.findBySlug(slug);
  }

  async findPublishedBySlug(slug: string): Promise<Post | null> {
    return this.postRepo.findPublishedBySlug(slug);
  }

  async createPost(data: CreatePostData, actorId: string): Promise<Post> {
    const rawSlug = data.slug || data.title;
    const finalSlug = await generateUniqueSlug(rawSlug, async (candidate) => {
      const existing = await this.postRepo.findBySlug(candidate);
      return !!existing;
    });

    const content = data.content || { version: 1, root: {} };

    const post = await this.postRepo.create({
      ...data,
      slug: finalSlug,
      content,
      createdBy: data.createdBy || actorId,
    });

    // Set authors
    const authorIds = data.authorIds && data.authorIds.length > 0 ? data.authorIds : [data.primaryAuthorId];
    await this.authorRepo.setPostAuthors(post.id, authorIds, data.primaryAuthorId);

    // Set tags
    if (data.tagIds) {
      await this.postRepo.setPostTagIds(post.id, data.tagIds);
    }

    // Update media references
    if (this.mediaService) {
      const mediaRefs = extractMediaReferencesFromDocument(post.content);
      await this.mediaService.updateResourceMediaReferences('post', post.id, mediaRefs);
    }

    // Create initial revision
    await this.revisionService.createRevision({
      resourceType: 'post',
      resourceId: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      contentVersion: post.contentVersion,
      createdBy: actorId,
    });

    // Audit
    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.created',
      targetType: 'post',
      targetId: post.id,
      metadata: { title: post.title, slug: post.slug },
    });

    return post;
  }

  async updatePost(id: string, data: UpdatePostData, actorId: string): Promise<Post> {
    const current = await this.postRepo.findById(id);
    if (!current) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    const expectedVersion = data.expectedVersion !== undefined ? data.expectedVersion : current.version;
    let finalSlug = current.slug;
    if (data.slug && data.slug !== current.slug) {
      finalSlug = await generateUniqueSlug(data.slug, async (candidate) => {
        const found = await this.postRepo.findBySlug(candidate);
        return !!found && found.id !== id;
      });
    }

    const updatePayload: Partial<Post> = {
      slug: finalSlug,
      updatedBy: actorId,
    };
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.excerpt !== undefined) updatePayload.excerpt = data.excerpt;
    if (data.content !== undefined) updatePayload.content = data.content;
    if (data.contentVersion !== undefined) updatePayload.contentVersion = data.contentVersion;
    if (data.visibility !== undefined) updatePayload.visibility = data.visibility;
    if (data.primaryAuthorId !== undefined) updatePayload.primaryAuthorId = data.primaryAuthorId;

    const updated = await this.postRepo.update(id, {
      ...updatePayload,
      version: expectedVersion,
    });

    if (data.primaryAuthorId || data.authorIds) {
      const primaryAuthorId = data.primaryAuthorId || current.primaryAuthorId;
      const authorIds = data.authorIds || [primaryAuthorId];
      await this.authorRepo.setPostAuthors(id, authorIds, primaryAuthorId);
    }

    if (data.tagIds) {
      await this.postRepo.setPostTagIds(id, data.tagIds);
    }

    if (this.mediaService && data.content !== undefined) {
      const mediaRefs = extractMediaReferencesFromDocument(updated.content);
      await this.mediaService.updateResourceMediaReferences('post', updated.id, mediaRefs);
    }

    // Create revision on update
    await this.revisionService.createRevision({
      resourceType: 'post',
      resourceId: updated.id,
      title: updated.title,
      slug: updated.slug,
      excerpt: updated.excerpt,
      content: updated.content,
      contentVersion: updated.contentVersion,
      createdBy: actorId,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.updated',
      targetType: 'post',
      targetId: updated.id,
      metadata: { title: updated.title, version: updated.version },
    });

    return updated;
  }

  async publishPost(id: string, actorId: string): Promise<Post> {
    const current = await this.postRepo.findById(id);
    if (!current) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    if (!current.title || !current.title.trim()) {
      const err = new Error('Post title is required to publish');
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const now = new Date();
    const publishedAt = current.publishedAt || now;

    const published = await this.postRepo.update(id, {
      status: 'published',
      publishedBy: actorId,
      publishedAt,
      scheduledAt: null,
      updatedBy: actorId,
      version: current.version,
    });

    await this.revisionService.createRevision({
      resourceType: 'post',
      resourceId: published.id,
      title: published.title,
      slug: published.slug,
      excerpt: published.excerpt,
      content: published.content,
      contentVersion: published.contentVersion,
      createdBy: actorId,
      metadata: { action: 'publish' },
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.published',
      targetType: 'post',
      targetId: published.id,
      metadata: { publishedAt },
    });

    domainEvents.emit('post.published', { postId: published.id, title: published.title, slug: published.slug });

    return published;
  }

  async unpublishPost(id: string, actorId: string): Promise<Post> {
    const current = await this.postRepo.findById(id);
    if (!current) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    const unpublished = await this.postRepo.update(id, {
      status: 'draft',
      updatedBy: actorId,
      version: current.version,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.unpublished',
      targetType: 'post',
      targetId: unpublished.id,
    });

    domainEvents.emit('post.unpublished', { postId: unpublished.id, slug: unpublished.slug });

    return unpublished;
  }

  async schedulePost(id: string, scheduledAt: Date, actorId: string): Promise<Post> {
    const current = await this.postRepo.findById(id);
    if (!current) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    if (!(scheduledAt instanceof Date) || isNaN(scheduledAt.getTime())) {
      const err = new Error('Invalid schedule timestamp');
      (err as any).code = 'INVALID_SCHEDULE_TIME';
      throw err;
    }

    if (scheduledAt.getTime() <= Date.now()) {
      const err = new Error('Scheduled time must be in the future');
      (err as any).code = 'INVALID_SCHEDULE_TIME';
      throw err;
    }

    const scheduled = await this.postRepo.update(id, {
      status: 'scheduled',
      scheduledAt,
      updatedBy: actorId,
      version: current.version,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.scheduled',
      targetType: 'post',
      targetId: scheduled.id,
      metadata: { scheduledAt },
    });

    return scheduled;
  }

  async cancelSchedule(id: string, actorId: string): Promise<Post> {
    const current = await this.postRepo.findById(id);
    if (!current) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    const canceled = await this.postRepo.update(id, {
      status: 'draft',
      scheduledAt: null,
      updatedBy: actorId,
      version: current.version,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.schedule.cancelled',
      targetType: 'post',
      targetId: canceled.id,
    });

    return canceled;
  }

  async restoreRevision(postId: string, revisionId: string, actorId: string): Promise<Post> {
    const post = await this.postRepo.findById(postId);
    if (!post) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    const rev = await this.revisionService.getRevisionById(revisionId);
    if (!rev || rev.resourceType !== 'post' || rev.resourceId !== postId) {
      const err = new Error('Revision not found for this post');
      (err as any).code = 'REVISION_NOT_FOUND';
      throw err;
    }

    const restored = await this.postRepo.update(postId, {
      title: rev.title,
      slug: rev.slug,
      excerpt: rev.excerpt,
      content: rev.content,
      contentVersion: rev.contentVersion,
      updatedBy: actorId,
      version: post.version,
    });

    if (this.mediaService) {
      const mediaRefs = extractMediaReferencesFromDocument(restored.content);
      await this.mediaService.updateResourceMediaReferences('post', restored.id, mediaRefs);
    }

    // Create a new revision recording the restoration
    await this.revisionService.createRevision({
      resourceType: 'post',
      resourceId: restored.id,
      title: restored.title,
      slug: restored.slug,
      excerpt: restored.excerpt,
      content: restored.content,
      contentVersion: restored.contentVersion,
      createdBy: actorId,
      metadata: { restoredFromRevisionId: revisionId },
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.revision.restored',
      targetType: 'post',
      targetId: restored.id,
      metadata: { revisionId, revisionNumber: rev.revisionNumber },
    });

    return restored;
  }

  async deletePost(id: string, actorId: string): Promise<void> {
    const current = await this.postRepo.findById(id);
    if (!current) {
      const err = new Error('Post not found');
      (err as any).code = 'POST_NOT_FOUND';
      throw err;
    }

    await this.postRepo.delete(id);

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'post.deleted',
      targetType: 'post',
      targetId: id,
    });

    domainEvents.emit('post.deleted', { postId: id });
  }

  async listPosts(filter?: ListPostsFilter): Promise<{ posts: Post[]; total: number }> {
    return this.postRepo.list(filter);
  }

  async getPostTagIds(postId: string): Promise<string[]> {
    return this.postRepo.getPostTagIds(postId);
  }

  async findDueScheduledPosts(now?: Date): Promise<Post[]> {
    return this.postRepo.findDueScheduledPosts(now);
  }
}
