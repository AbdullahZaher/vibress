import {
  getDb,
  members,
  subscriptions,
  emailRecipients,
  posts,
  pages,
} from '@vibress/database';
import { and, eq, gte, lte, sql, inArray, isNull, desc, count, isNotNull } from 'drizzle-orm';
import { AnalyticsRepository } from '../domain/analytics';
import { ACCESS_GRANTING_STATUSES } from '@vibress/subscriptions';
import {
  resolveDateRange,
  computePercentageChange,
  toUtcDay,
  AnalyticsRange,
} from './analytics-helpers';

// Paid entitlement reuses the existing subscriptions domain policy:
// ACCESS_GRANTING_STATUSES (trialing/active) is what Vibress uses to decide
// whether a member currently has paid access. past_due/unpaid/cancelled/
// expired/incomplete intentionally do NOT grant access. Never invent an
// Analytics-specific status list.
const SENT_RECIPIENT_STATUSES = ['sent', 'delivered'];

export interface AnalyticsTimeseriesPoint {
  date: string;
  views: number;
  visitors: number;
  members: number;
}

export interface AnalyticsOverview {
  range: { range: AnalyticsRange; from: string; to: string };
  summary: { views: number; visitors: number; members: number; paidMembers: number };
  comparison: {
    views: { current: number; previous: number; percentage: number | null; isNew: boolean };
    visitors: { current: number; previous: number; percentage: number | null; isNew: boolean };
    members: { current: number; previous: number; percentage: number | null; isNew: boolean };
  };
  timeseries: AnalyticsTimeseriesPoint[];
  latestPost: { id: string; title: string; slug: string; publishedAt: string; views: number } | null;
  topPosts: Array<{ path: string; title: string; views: number }>;
  topContent: Array<{ path: string; title: string; type: string; views: number }>;
  referrers: Array<{ name: string; views: number }>;
  newsletter: { sent: number; openRate: number; clickRate: number };
  growth: { freeMembers: number; paidMembers: number };
}

export class AnalyticsOverviewService {
  constructor(private repo: AnalyticsRepository) {}

  /**
   * Dashboard payload for a UI range. Views/timeseries come from daily
   * aggregates; unique visitors always come from COUNT(DISTINCT visitor_hash)
   * over retained raw events — never from summed daily counters.
   */
  async getOverview(input: { range?: string; limit?: number } = {}): Promise<AnalyticsOverview> {
    const now = new Date();
    const resolved = resolveDateRange(input.range, now);
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    const current = { from: resolved.from, to: resolved.to };
    const previous = { from: resolved.previousFrom, to: resolved.previousTo };

    const [viewsByDay, visitorsTotal, visitorsPrev, visitorsByDay, topPosts, topContent, referrers] =
      await Promise.all([
        this.repo.getTrafficViewsByDay(toUtcDay(resolved.from), toUtcDay(resolved.to)),
        this.repo.countDistinctVisitors(current.from, current.to),
        this.repo.countDistinctVisitors(previous.from, previous.to),
        this.repo.countDistinctVisitorsByDay(current.from, current.to),
        this.repo.getTopTrafficPaths(current.from, current.to, 'post', limit),
        this.repo.getTopTrafficPaths(current.from, current.to, null, limit),
        this.repo.getTopTrafficReferrers(current.from, current.to, 10),
      ]);

    const viewsTotal = viewsByDay.reduce((sum, d) => sum + d.views, 0);
    const prevViews = await this.sumViews(resolved.previousFrom, resolved.previousTo);

    const [membersCurrent, membersNew, membersPrev, membersByDay, paidMembers, newsletter] = await Promise.all([
      this.countActiveMembers(),
      this.countActiveMembersBetween(current.from, current.to),
      this.countActiveMembersBetween(previous.from, previous.to),
      this.membersByDay(current.from, current.to),
      this.countPaidMembers(),
      this.newsletterMetrics(),
    ]);

    const latestPost = await this.latestPostWithViews(current.from, current.to);

    const timeseries = this.mergeTimeseries(viewsByDay, visitorsByDay, membersByDay, resolved.from, resolved.to);

    const paid = paidMembers;
    const free = Math.max(membersCurrent - paid, 0);

    return {
      range: { range: resolved.range, from: toUtcDay(resolved.from), to: toUtcDay(resolved.to) },
      summary: { views: viewsTotal, visitors: visitorsTotal, members: membersCurrent, paidMembers: paid },
      comparison: {
        views: computePercentageChange(viewsTotal, prevViews),
        visitors: computePercentageChange(visitorsTotal, visitorsPrev),
        members: computePercentageChange(membersNew, membersPrev),
      },
      timeseries,
      latestPost,
      topPosts: await this.resolveTitles(topPosts, 'post'),
      topContent: await this.resolveTitles(topContent, null),
      referrers: referrers.map((r) => ({
        name: r.key === 'direct' ? 'Direct' : r.key,
        views: r.views,
      })),
      newsletter,
      growth: { freeMembers: free, paidMembers: paid },
    };
  }

  /** Views total for an arbitrary date window (previous-period comparison). */
  private async sumViews(from: Date, to: Date): Promise<number> {
    const daily = await this.repo.getTrafficViewsByDay(toUtcDay(from), toUtcDay(to));
    return daily.reduce((sum, d) => sum + d.views, 0);
  }

  private async countActiveMembers(): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: count() })
      .from(members)
      .where(and(eq(members.status, 'active'), isNull(members.disabledAt)));
    return Number(rows[0]?.total || 0);
  }

  private async countActiveMembersBetween(from: Date, to: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: count() })
      .from(members)
      .where(and(
        eq(members.status, 'active'),
        isNull(members.disabledAt),
        gte(members.createdAt, from),
        lte(members.createdAt, to),
      ));
    return Number(rows[0]?.total || 0);
  }

  private async membersByDay(from: Date, to: Date): Promise<Array<{ date: string; members: number }>> {
    const db = getDb();
    const rows = await db
      .select({
        date: sql<string>`to_char(${members.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        members: sql<number>`count(*)::int`,
      })
      .from(members)
      .where(and(
        eq(members.status, 'active'),
        isNull(members.disabledAt),
        gte(members.createdAt, from),
        lte(members.createdAt, to),
      ))
      .groupBy(sql`to_char(${members.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${members.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`);
    return rows.map((r) => ({ date: String(r.date), members: Number(r.members) || 0 }));
  }

  private async countPaidMembers(): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: sql<number>`count(distinct ${subscriptions.memberId})::int` })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ACCESS_GRANTING_STATUSES));
    return Number(rows[0]?.total || 0);
  }

  private async newsletterMetrics(): Promise<{ sent: number; openRate: number; clickRate: number }> {
    const db = getDb();
    const rows = await db
      .select({
        sent: sql<number>`count(*)::int`,
        opened: sql<number>`count(${emailRecipients.openedAt})::int`,
        clicked: sql<number>`count(${emailRecipients.clickedAt})::int`,
      })
      .from(emailRecipients)
      .where(inArray(emailRecipients.status, SENT_RECIPIENT_STATUSES));
    const sent = Number(rows[0]?.sent || 0);
    const opened = Number(rows[0]?.opened || 0);
    const clicked = Number(rows[0]?.clicked || 0);
    return {
      sent,
      openRate: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
      clickRate: sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : 0,
    };
  }

  private async latestPostWithViews(from: Date, to: Date): Promise<AnalyticsOverview['latestPost']> {
    const db = getDb();
    const rows = await db
      .select({ id: posts.id, title: posts.title, slug: posts.slug, publishedAt: posts.publishedAt })
      .from(posts)
      .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt), isNotNull(posts.publishedAt)))
      .orderBy(desc(posts.publishedAt))
      .limit(1);
    const post = rows[0];
    if (!post || !post.slug) return null;

    const path = `/posts/${post.slug}`;
    const pathRows = await this.repo.getTopTrafficPaths(from, to, 'post', 50);
    const match = pathRows.find((p) => p.key === path);
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : '',
      views: match?.views ?? 0,
    };
  }

  private async resolveTitles(
    rows: Array<{ key: string; views: number }>,
    entityType: string | null
  ): Promise<Array<{ path: string; title: string; type: string; views: number }>> {
    const db = getDb();
    const out: Array<{ path: string; title: string; type: string; views: number }> = [];
    const postSlugs: string[] = [];
    const pageSlugs: string[] = [];

    for (const r of rows) {
      const m = r.key.match(/^\/posts\/([^/]+)$/);
      const p = r.key.match(/^\/pages\/([^/]+)$/);
      if (m && m[1]) postSlugs.push(m[1]);
      else if (p && p[1]) pageSlugs.push(p[1]);
    }

    const [postRows, pageRows] = await Promise.all([
      postSlugs.length
        ? db.select({ slug: posts.slug, title: posts.title }).from(posts).where(inArray(posts.slug, postSlugs))
        : Promise.resolve([] as Array<{ slug: string; title: string }>),
      pageSlugs.length
        ? db.select({ slug: pages.slug, title: pages.title }).from(pages).where(inArray(pages.slug, pageSlugs))
        : Promise.resolve([] as Array<{ slug: string; title: string }>),
    ]);

    const postTitle = new Map(postRows.map((p) => [p.slug, p.title]));
    const pageTitle = new Map(pageRows.map((p) => [p.slug, p.title]));

    for (const r of rows) {
      const m = r.key.match(/^\/posts\/([^/]+)$/);
      const p = r.key.match(/^\/pages\/([^/]+)$/);
      if (m && m[1]) {
        const title = postTitle.get(m[1]);
        if (entityType === null || entityType === 'post') {
          out.push({ path: r.key, title: title ?? `/${m[1]}`, type: 'post', views: r.views });
        }
      } else if (p && p[1]) {
        const title = pageTitle.get(p[1]);
        if (entityType === null || entityType === 'page') {
          out.push({ path: r.key, title: title ?? `/${p[1]}`, type: 'page', views: r.views });
        }
      } else if (entityType === null) {
        out.push({ path: r.key, title: r.key, type: 'page', views: r.views });
      }
    }
    return out;
  }

  private mergeTimeseries(
    viewsByDay: Array<{ date: string; views: number }>,
    visitorsByDay: Array<{ date: string; visitors: number }>,
    membersByDay: Array<{ date: string; members: number }>,
    from: Date,
    to: Date
  ): AnalyticsTimeseriesPoint[] {
    const views = new Map(viewsByDay.map((d) => [d.date, d.views]));
    const visitors = new Map(visitorsByDay.map((d) => [d.date, d.visitors]));
    const members = new Map(membersByDay.map((d) => [d.date, d.members]));
    const out: AnalyticsTimeseriesPoint[] = [];
    const fromDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const toDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    const dayMs = 24 * 3600 * 1000;
    for (let d = fromDay.getTime(); d <= toDay.getTime(); d += dayMs) {
      const date = toUtcDay(new Date(d));
      out.push({ date, views: views.get(date) ?? 0, visitors: visitors.get(date) ?? 0, members: members.get(date) ?? 0 });
    }
    return out;
  }
}
