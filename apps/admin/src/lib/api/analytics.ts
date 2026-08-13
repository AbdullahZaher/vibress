import { apiRequest } from './client';

export type AnalyticsRange = '7d' | '30d' | '90d';

export interface AnalyticsTimeseriesPoint {
  date: string;
  views: number;
  visitors: number;
  members: number;
}

export interface PercentageChange {
  current: number;
  previous: number;
  percentage: number | null;
  isNew: boolean;
}

export interface AnalyticsOverview {
  range: { range: AnalyticsRange; from: string; to: string };
  summary: { views: number; visitors: number; members: number; paidMembers: number };
  comparison: {
    views: PercentageChange;
    visitors: PercentageChange;
    members: PercentageChange;
  };
  timeseries: AnalyticsTimeseriesPoint[];
  latestPost: { id: string; title: string; slug: string; publishedAt: string; views: number } | null;
  topPosts: Array<{ path: string; title: string; views: number }>;
  topContent: Array<{ path: string; title: string; type: string; views: number }>;
  referrers: Array<{ name: string; views: number }>;
  newsletter: { sent: number; openRate: number; clickRate: number };
  growth: { freeMembers: number; paidMembers: number };
}

export async function getAnalyticsOverviewApi(range: AnalyticsRange): Promise<AnalyticsOverview> {
  return apiRequest<AnalyticsOverview>(`/analytics/overview?range=${range}`);
}

export function formatCompact(n: number): string {
  if (n >= 1000) {
    const v = n / 1000;
    return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}k`;
  }
  return String(n);
}
