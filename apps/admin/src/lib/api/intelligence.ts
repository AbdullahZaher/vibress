import { apiRequest } from "./client";

export interface AdminMetric {
  date: string;
  name: string;
  count: number;
}

export async function getAnalyticsMetricsApi(
  params: { from?: string; to?: string; metricName?: string } = {},
): Promise<{
  metrics: AdminMetric[];
  from: string;
  to: string;
  timezone: string;
}> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.metricName) query.set("metricName", params.metricName);
  return apiRequest(`/analytics/metrics?${query.toString()}`);
}

export async function rebuildSearchIndexApi(): Promise<{ accepted: boolean }> {
  return apiRequest("/search/rebuild", { method: "POST" });
}

export async function getSearchIndexCountApi(): Promise<{ count: number }> {
  return apiRequest("/search/index-count");
}
