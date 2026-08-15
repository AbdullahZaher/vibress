import { SearchDocumentInput } from "@vibress/search";
import { DrizzlePostRepository } from "@vibress/posts";
import { DrizzlePageRepository } from "@vibress/pages";
import { DrizzleTagRepository } from "@vibress/tags";
import { renderStudioDocumentToPlainText } from "@vibress/studio-renderer";
import { getConfig } from "@vibress/config";

/**
 * Worker-side content source for full index rebuilds.
 * Only published, public posts/pages and tags are indexed — restricted
 * content is never searchable.
 */
export class WorkerSearchContentSource {
  private postRepo = new DrizzlePostRepository();
  private pageRepo = new DrizzlePageRepository();
  private tagRepo = new DrizzleTagRepository();

  async listIndexableContent(): Promise<SearchDocumentInput[]> {
    const docs: SearchDocumentInput[] = [];
    const siteUrl = getConfig().site.url;

    const PAGE_SIZE = 100;
    let offset = 0;
    for (;;) {
      const { posts: postRows } = await this.postRepo.list({
        publishedOnly: true,
        limit: PAGE_SIZE,
        offset,
      });
      for (const post of postRows) {
        if (post.visibility !== "public") continue;
        docs.push({
          entityType: "post",
          entityId: post.id,
          title: post.title,
          bodyText: renderStudioDocumentToPlainText(post.content).slice(
            0,
            2000,
          ),
          slug: post.slug,
          url: `${siteUrl}/posts/${post.slug}`,
        });
      }
      if (postRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    offset = 0;
    for (;;) {
      const { pages: pageRows } = await this.pageRepo.list({
        publishedOnly: true,
        limit: PAGE_SIZE,
        offset,
      });
      for (const pg of pageRows) {
        if (pg.visibility !== "public") continue;
        docs.push({
          entityType: "page",
          entityId: pg.id,
          title: pg.title,
          bodyText: renderStudioDocumentToPlainText(pg.content).slice(0, 2000),
          slug: pg.slug,
          url: `${siteUrl}/${pg.slug}`,
        });
      }
      if (pageRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const tags = await this.tagRepo.listAll();
    for (const tag of tags) {
      docs.push({
        entityType: "tag",
        entityId: tag.id,
        title: tag.name,
        slug: tag.slug,
        url: `${siteUrl}/tags/${tag.slug}`,
      });
    }

    return docs;
  }
}
