import { PageRepository } from '../domain/repository';
import { Page, CreatePageData, UpdatePageData, ListPagesFilter, PageDomainError } from '../domain/page';
import { RevisionsService } from '@vibress/revisions';
import { AuthorRepository } from '@vibress/authors';
import { AuditRepository } from '@vibress/audit';
import { extractMediaReferencesFromDocument, MediaService } from '@vibress/media';
import { generateUniqueSlug } from '@vibress/utils';
import { runInTransaction } from '@vibress/database';

export class PagesService {
  constructor(
    private pageRepo: PageRepository,
    private revisionService: RevisionsService,
    private authorRepo: AuthorRepository,
    private auditRepo: AuditRepository,
    private mediaService?: MediaService
  ) {}

  async findById(id: string): Promise<Page | null> {
    return this.pageRepo.findById(id);
  }

  async findBySlug(slug: string): Promise<Page | null> {
    return this.pageRepo.findBySlug(slug);
  }

  async findPublishedBySlug(slug: string): Promise<Page | null> {
    return this.pageRepo.findPublishedBySlug(slug);
  }

  async createPage(data: CreatePageData, actorId: string): Promise<Page> {
    return runInTransaction(() => this.createPageTx(data, actorId));
  }

  private async createPageTx(data: CreatePageData, actorId: string): Promise<Page> {
    const rawSlug = data.slug || data.title;
    const finalSlug = await generateUniqueSlug(rawSlug, async (candidate) => {
      const existing = await this.pageRepo.findBySlug(candidate);
      return !!existing;
    });

    const content = data.content || { version: 1, root: {} };

    const page = await this.pageRepo.create({
      ...data,
      slug: finalSlug,
      content,
      createdBy: data.createdBy || actorId,
    });

    const authorIds = data.authorIds && data.authorIds.length > 0 ? data.authorIds : [data.primaryAuthorId];
    await this.authorRepo.setPageAuthors(page.id, authorIds, data.primaryAuthorId);

    if (this.mediaService) {
      const mediaRefs = extractMediaReferencesFromDocument(page.content);
      await this.mediaService.updateResourceMediaReferences('page', page.id, mediaRefs);
    }

    await this.revisionService.createRevision({
      resourceType: 'page',
      resourceId: page.id,
      title: page.title,
      slug: page.slug,
      excerpt: page.excerpt,
      content: page.content,
      contentVersion: page.contentVersion,
      createdBy: actorId,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'page.created',
      targetType: 'page',
      targetId: page.id,
      metadata: { title: page.title, slug: page.slug },
    });

    return page;
  }

  async updatePage(id: string, data: UpdatePageData, actorId: string): Promise<Page> {
    return runInTransaction(() => this.updatePageTx(id, data, actorId));
  }

  private async updatePageTx(id: string, data: UpdatePageData, actorId: string): Promise<Page> {
    const current = await this.pageRepo.findById(id);
    if (!current) {
      throw new PageDomainError('PAGE_NOT_FOUND', 'Page not found');
    }

    const expectedVersion = data.expectedVersion !== undefined ? data.expectedVersion : current.version;
    let finalSlug = current.slug;
    if (data.slug && data.slug !== current.slug) {
      finalSlug = await generateUniqueSlug(data.slug, async (candidate) => {
        const found = await this.pageRepo.findBySlug(candidate);
        return !!found && found.id !== id;
      });
    }

    const updatePayload: Partial<Page> = {
      slug: finalSlug,
      updatedBy: actorId,
    };
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.excerpt !== undefined) updatePayload.excerpt = data.excerpt;
    if (data.content !== undefined) updatePayload.content = data.content;
    if (data.contentVersion !== undefined) updatePayload.contentVersion = data.contentVersion;
    if (data.visibility !== undefined) updatePayload.visibility = data.visibility;
    if (data.primaryAuthorId !== undefined) updatePayload.primaryAuthorId = data.primaryAuthorId;

    const updated = await this.pageRepo.update(id, {
      ...updatePayload,
      version: expectedVersion,
    });

    if (data.primaryAuthorId || data.authorIds) {
      const primaryAuthorId = data.primaryAuthorId || current.primaryAuthorId;
      const authorIds = data.authorIds || [primaryAuthorId];
      await this.authorRepo.setPageAuthors(id, authorIds, primaryAuthorId);
    }

    if (this.mediaService && data.content !== undefined) {
      const mediaRefs = extractMediaReferencesFromDocument(updated.content);
      await this.mediaService.updateResourceMediaReferences('page', updated.id, mediaRefs);
    }

    await this.revisionService.createRevision({
      resourceType: 'page',
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
      action: 'page.updated',
      targetType: 'page',
      targetId: updated.id,
      metadata: { title: updated.title, version: updated.version },
    });

    return updated;
  }

  async publishPage(id: string, actorId: string): Promise<Page> {
    return runInTransaction(() => this.publishPageTx(id, actorId));
  }

  private async publishPageTx(id: string, actorId: string): Promise<Page> {
    const current = await this.pageRepo.findById(id);
    if (!current) {
      throw new PageDomainError('PAGE_NOT_FOUND', 'Page not found');
    }

    if (!current.title || !current.title.trim()) {
      throw new PageDomainError('VALIDATION_ERROR', 'Page title is required to publish');
    }

    const now = new Date();
    const publishedAt = current.publishedAt || now;

    const published = await this.pageRepo.update(id, {
      status: 'published',
      publishedBy: actorId,
      publishedAt,
      scheduledAt: null,
      updatedBy: actorId,
      version: current.version,
    });

    await this.revisionService.createRevision({
      resourceType: 'page',
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
      action: 'page.published',
      targetType: 'page',
      targetId: published.id,
      metadata: { publishedAt },
    });

    return published;
  }

  async unpublishPage(id: string, actorId: string): Promise<Page> {
    return runInTransaction(() => this.unpublishPageTx(id, actorId));
  }

  private async unpublishPageTx(id: string, actorId: string): Promise<Page> {
    const current = await this.pageRepo.findById(id);
    if (!current) {
      throw new PageDomainError('PAGE_NOT_FOUND', 'Page not found');
    }

    const unpublished = await this.pageRepo.update(id, {
      status: 'draft',
      updatedBy: actorId,
      version: current.version,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'page.unpublished',
      targetType: 'page',
      targetId: unpublished.id,
    });

    return unpublished;
  }

  async schedulePage(id: string, scheduledAt: Date, actorId: string): Promise<Page> {
    return runInTransaction(() => this.schedulePageTx(id, scheduledAt, actorId));
  }

  private async schedulePageTx(id: string, scheduledAt: Date, actorId: string): Promise<Page> {
    const current = await this.pageRepo.findById(id);
    if (!current) {
      throw new PageDomainError('PAGE_NOT_FOUND', 'Page not found');
    }

    if (!(scheduledAt instanceof Date) || isNaN(scheduledAt.getTime())) {
      throw new PageDomainError('INVALID_SCHEDULE_TIME', 'Invalid schedule timestamp');
    }

    if (scheduledAt.getTime() <= Date.now()) {
      throw new PageDomainError('INVALID_SCHEDULE_TIME', 'Scheduled time must be in the future');
    }

    const scheduled = await this.pageRepo.update(id, {
      status: 'scheduled',
      scheduledAt,
      updatedBy: actorId,
      version: current.version,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'page.scheduled',
      targetType: 'page',
      targetId: scheduled.id,
      metadata: { scheduledAt },
    });

    return scheduled;
  }

  async cancelSchedule(id: string, actorId: string): Promise<Page> {
    return runInTransaction(() => this.cancelScheduleTx(id, actorId));
  }

  private async cancelScheduleTx(id: string, actorId: string): Promise<Page> {
    const current = await this.pageRepo.findById(id);
    if (!current) {
      throw new PageDomainError('PAGE_NOT_FOUND', 'Page not found');
    }

    const canceled = await this.pageRepo.update(id, {
      status: 'draft',
      scheduledAt: null,
      updatedBy: actorId,
      version: current.version,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'page.schedule.cancelled',
      targetType: 'page',
      targetId: canceled.id,
    });

    return canceled;
  }

  async deletePage(id: string, actorId: string): Promise<void> {
    return runInTransaction(() => this.deletePageTx(id, actorId));
  }

  private async deletePageTx(id: string, actorId: string): Promise<void> {
    const current = await this.pageRepo.findById(id);
    if (!current) {
      throw new PageDomainError('PAGE_NOT_FOUND', 'Page not found');
    }

    await this.pageRepo.delete(id);

    await this.auditRepo.record({
      actorUserId: actorId,
      action: 'page.deleted',
      targetType: 'page',
      targetId: id,
    });
  }

  async listPages(filter?: ListPagesFilter): Promise<{ pages: Page[]; total: number }> {
    return this.pageRepo.list(filter);
  }

  async findDueScheduledPages(now?: Date): Promise<Page[]> {
    return this.pageRepo.findDueScheduledPages(now);
  }
}
