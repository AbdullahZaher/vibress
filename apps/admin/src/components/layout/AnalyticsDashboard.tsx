import React, { useMemo, useState } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Calendar,
  ChevronDown,
  Globe,
  Eye,
  FileText,
  ChartNoAxesCombined,
} from "lucide-react";
import { ApiUser } from "../../lib/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { AdminPageHeader } from "../common/AdminPageHeader";
import {
  getAnalyticsOverviewApi,
  AnalyticsRange,
  AnalyticsOverview,
  AnalyticsTimeseriesPoint,
  formatCompact,
} from "../../lib/api/analytics";

interface AnalyticsDashboardProps {
  user: ApiUser;
}

const DATE_OPTIONS: Array<{ label: string; range: AnalyticsRange }> = [
  { label: "Last 7 days", range: "7d" },
  { label: "Last 30 days", range: "30d" },
  { label: "Last 90 days", range: "90d" },
];

function ChangeBadge({
  change,
  current,
}: {
  change: { percentage: number | null; isNew: boolean };
  current: number;
}) {
  const { tr, formatNumber } = useAdminLocale();
  // Zero current activity or zero change must not be signaled as growth.
  if (current === 0 || change.percentage === 0) return null;
  if (change.isNew) {
    return (
      <Badge
        variant="outline"
        className="text-xs font-medium px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      >
        {tr("New")}
      </Badge>
    );
  }
  if (change.percentage === null) {
    return (
      <Badge
        variant="outline"
        className="text-xs font-medium px-2 py-0.5 bg-muted text-muted-foreground border-border"
      >
        —
      </Badge>
    );
  }
  const positive = change.percentage >= 0;
  return (
    <Badge
      variant="outline"
      className={`text-xs font-medium px-2 py-0.5 ${
        positive
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
      }`}
    >
      {positive ? "+" : ""}
      {formatNumber(change.percentage)}%
    </Badge>
  );
}

function displayAnalyticsDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-US", {
    day: "numeric", month: "short",
  }).format(date);
}

/** Lightweight data-driven area chart (no chart dependency). */
function AreaChart({
  points,
  metric,
  color,
}: {
  points: AnalyticsTimeseriesPoint[];
  metric: "views" | "visitors" | "members";
  color: string;
}) {
  const { tr, locale } = useAdminLocale();
  const [showData, setShowData] = useState(false);
  const values = points.map((point) => point[metric]);
  const max = Math.max(1, ...values);
  const ceiling = Math.ceil(max / 4) * 4;
  const hasData = values.some((value) => value > 0);
  const format = (value: number) => value.toLocaleString(locale);
  const coords = values.map((value, index) => ({
    x: values.length === 1 ? 50 : (index / Math.max(1, values.length - 1)) * 100,
    y: 96 - (value / ceiling) * 90,
  }));
  const line = coords.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join(" ");
  const area = coords.length ? `${line} L 100 100 L 0 100 Z` : "";
  const start = points[0]?.date;
  const end = points[points.length - 1]?.date;
  const gradientId = `chart-gradient-${metric}`;

  if (!hasData) {
    return (
      <div role="status" className="flex min-h-20 items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-3">
        <ChartNoAxesCombined className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{tr("No activity in this period")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{tr("Activity will appear here when data is available.")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-3">
        <div aria-hidden="true" className="flex h-32 shrink-0 flex-col justify-between text-end text-xs tabular-nums text-muted-foreground">
          {[ceiling, ceiling * 0.75, ceiling * 0.5, ceiling * 0.25, 0].map((tick) => (
            <span key={tick}>{format(tick)}</span>
          ))}
        </div>
        <div className="relative h-32 min-w-0 flex-1" role="img" aria-label={`${tr("Activity trend")}: ${tr(metric)} ${start || ""} – ${end || ""}`}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3, 4].map((tick) => <span key={tick} className="w-full border-t border-border/60" />)}
          </div>
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gradientId})`} />
              <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap gap-x-2 tabular-nums">
          {start && <time dateTime={start}>{displayAnalyticsDate(start, locale)}</time>}
          {end && <><span aria-hidden="true">—</span><time dateTime={end}>{displayAnalyticsDate(end, locale)}</time></>}
        </div>
        {points.length > 0 && (
          <button type="button" aria-expanded={showData} onClick={() => setShowData((open) => !open)}
            className="shrink-0 min-h-10 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            {showData ? tr("Hide data") : tr("View data")}
          </button>
        )}
      </div>
      {showData && points.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{tr("Activity trend")}</caption>
            <thead className="sticky top-0 bg-muted text-muted-foreground"><tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{tr("Date")}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{tr(metric)}</th>
            </tr></thead>
            <tbody>{points.map((point, index) => (
              <tr key={`${point.date}-${index}`} className="border-t border-border/60">
                <td className="px-3 py-2 tabular-nums"><time dateTime={point.date}>{displayAnalyticsDate(point.date, locale)}</time></td>
                <td className="px-3 py-2 text-end tabular-nums">{format(point[metric])}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 w-full animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border border-border/60 bg-card/60 space-y-4">
          <div className="flex justify-between">
            <div className="space-y-2">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-7 w-24 bg-muted rounded" />
            </div>
            <div className="h-6 w-16 bg-muted rounded" />
          </div>
          <div className="h-28 w-full bg-muted/40 rounded-lg" />
        </div>
        <div className="p-5 rounded-xl border border-border/60 bg-card/60 space-y-4">
          <div className="flex justify-between">
            <div className="space-y-2">
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="h-7 w-28 bg-muted rounded" />
            </div>
            <div className="h-6 w-16 bg-muted rounded" />
          </div>
          <div className="h-28 w-full bg-muted/40 rounded-lg" />
        </div>
      </div>
      <div className="p-5 rounded-xl border border-border/60 bg-card/60 space-y-3">
        <div className="h-3 w-40 bg-muted rounded" />
        <div className="h-20 w-full bg-muted/40 rounded-lg" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { tr } = useAdminLocale();
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <p className="text-sm text-muted-foreground">{tr("Unable to load analytics")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {tr("Retry")}
      </Button>
    </div>
  );
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = () => {
  const { tr, locale } = useAdminLocale();
  const [analyticsTab, setAnalyticsTab] = useState<
    "overview" | "web" | "newsletters" | "growth"
  >("overview");
  const [dateLabel, setDateLabel] = useState("Last 30 days");
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [trafficMetric, setTrafficMetric] = useState<"views" | "visitors">(
    "views",
  );
  const [topContentType, setTopContentType] = useState<
    "all" | "posts" | "pages"
  >("all");

  const activeRange = useMemo(
    () => DATE_OPTIONS.find((o) => o.label === dateLabel)!.range,
    [dateLabel],
  );

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", activeRange],
    queryFn: () => getAnalyticsOverviewApi(activeRange),
    staleTime: 60 * 1000,
  });

  const data: AnalyticsOverview | undefined = overviewQuery.data;

  const topContent = useMemo(() => {
    if (!data) return [];
    if (topContentType === "all") return data.topContent;
    return data.topContent.filter((c) => c.type === topContentType);
  }, [data, topContentType]);

  const totalViews = data?.summary.views ?? 0;
  const totalVisitors = data?.summary.visitors ?? 0;

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Page Title Header */}
      <AdminPageHeader
        title={tr("Analytics")}
        description={tr("Monitor publication traffic, readership engagement, and subscriber growth.")}
      />

      {/* Navigation Tabs & Date Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div role="group" aria-label={tr("Analytics")} className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-1 sm:w-auto sm:pb-0">
          {(["overview", "web", "newsletters", "growth"] as const).map((t) => (
            <button
              key={tr(t.charAt(0).toUpperCase() + t.slice(1))}
              onClick={() => setAnalyticsTab(t)}
              aria-pressed={analyticsTab === t}
              className={`min-h-11 shrink-0 whitespace-nowrap px-3.5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer capitalize focus-visible:outline-2 focus-visible:outline-ring ${
                analyticsTab === t
                  ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tr(t === "web" ? "Web traffic" : t.charAt(0).toUpperCase() + t.slice(1))}
            </button>
          ))}
        </div>

        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsDateOpen(!isDateOpen)}
            aria-expanded={isDateOpen}
            className="min-h-10 text-sm font-medium text-foreground border-border bg-card hover:bg-accent gap-2 cursor-pointer"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{tr(dateLabel)}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>

          {isDateOpen && (
            <div className="absolute end-0 mt-1 w-44 rounded-lg bg-card border border-border shadow-lg py-1 z-30 space-y-0.5">
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.range}
                  onClick={() => {
                    setDateLabel(opt.label);
                    setIsDateOpen(false);
                  }}
                  className={`w-full text-start min-h-10 px-3 py-2 text-sm transition-colors cursor-pointer ${
                    dateLabel === opt.label
                      ? "bg-sidebar-accent text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {tr(opt.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {overviewQuery.isLoading && <LoadingState />}
      {overviewQuery.isError && (
        <ErrorState onRetry={() => overviewQuery.refetch()} />
      )}

      {overviewQuery.isSuccess && data && (
        <>
          {/* TAB 1: OVERVIEW */}
          {analyticsTab === "overview" && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Members KPI Card */}
                <Card className="p-5 border-border/70 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium mb-1">
                        <Users className="h-3.5 w-3.5" /> {tr("Members")}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground tabular-nums">
                          {data.summary.members.toLocaleString(locale)}
                        </span>
                        <ChangeBadge change={data.comparison.members} current={data.summary.members} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAnalyticsTab("growth")}
                      className="min-h-10 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {tr("View details")}
                    </Button>
                  </div>
                  <AreaChart
                    points={data.timeseries}
                    metric="members"
                    color="#60a5fa"
                  />
                </Card>

                {/* Unique Visitors KPI Card */}
                <Card className="p-5 border-border/70 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium mb-1">
                        <Globe className="h-3.5 w-3.5" /> {tr("Unique Visitors")}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground tabular-nums">
                          {totalVisitors.toLocaleString(locale)}
                        </span>
                        <ChangeBadge change={data.comparison.visitors} current={totalVisitors} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAnalyticsTab("web")}
                      className="min-h-10 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {tr("View details")}
                    </Button>
                  </div>
                  <AreaChart
                    points={data.timeseries}
                    metric="visitors"
                    color="#3eb083"
                  />
                </Card>
              </div>

              {/* Latest Post Performance */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground tracking-wide">
                  {tr("LATEST POST PERFORMANCE")}
                </h3>
                {data.latestPost ? (
                  <Card className="p-5 border-border/70 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4 min-w-0">
                      <div aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground sm:h-24 sm:w-28">
                        <FileText className="size-7" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="font-bold text-base text-foreground truncate">
                          {data.latestPost.title}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {tr("Published")} · {new Date(data.latestPost.publishedAt).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US")}
                        </p>
                        <div className="pt-1">
                          <Badge
                            variant="outline"
                            className="text-xs font-medium px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          >
                            {tr("Published")}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-row md:flex-col gap-6 md:gap-3 text-xs text-muted-foreground font-mono self-start md:self-center border-t md:border-t-0 border-border pt-4 md:pt-0 w-full md:w-auto justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-emerald-500" />
                        <span>{tr("Views")}</span>
                        <span className="font-bold text-foreground text-sm ms-auto tabular-nums">
                          {data.latestPost.views.toLocaleString(locale)}
                        </span>
                      </div>
                    </div>
                  </Card>
                ) : (
                  <Card className="p-5 border-border/70 shadow-2xs text-sm text-muted-foreground">
                    {tr("No published posts yet.")}
                  </Card>
                )}
              </div>

              {/* Top Posts in the period */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground tracking-wide">
                  {tr("Top posts")} · {tr(dateLabel)}
                </h3>
                {data.topPosts.length === 0 ? (
                  <Card className="p-5 border-border/70 shadow-2xs text-sm text-muted-foreground">
                    {tr("No traffic yet.")}
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {data.topPosts.map((post, idx) => (
                      <Card
                        key={post.path}
                        className="p-4 border-border/70 shadow-2xs flex items-center justify-between hover:border-sidebar-border transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <span className="text-xs font-mono font-bold text-muted-foreground w-4">
                            {idx + 1}
                          </span>
                          <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <FileText className="size-4" />
                          </div>
                          <div className="truncate">
                            <h4 className="font-semibold text-sm text-foreground truncate">
                              {post.title}
                            </h4>
                            <p className="text-xs text-muted-foreground truncate">
                              {post.path}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono shrink-0 ms-3">
                          <div className="flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5" />{" "}
                            <span>{post.views.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}</span>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: WEB TRAFFIC */}
          {analyticsTab === "web" && (
            <div className="space-y-6">
              <Card className="p-6 border-border/70 shadow-2xs space-y-6">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setTrafficMetric("views")}
                    aria-pressed={trafficMetric === "views"}
                    className={`min-h-10 px-3 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                      trafficMetric === "views"
                        ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tr("Total views")} ({formatCompact(totalViews)})
                  </button>
                  <button
                    onClick={() => setTrafficMetric("visitors")}
                    aria-pressed={trafficMetric === "visitors"}
                    className={`min-h-10 px-3 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                      trafficMetric === "visitors"
                        ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tr("Unique visitors")} ({formatCompact(totalVisitors)})
                  </button>
                </div>

                <AreaChart
                  points={data.timeseries}
                  metric={trafficMetric}
                  color="#3eb083"
                />
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Content */}
                <Card className="p-5 border-border/70 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tr("Top Content")}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1">
                      {(["all", "posts", "pages"] as const).map((t) => (
                        <button
                          key={tr(t.charAt(0).toUpperCase() + t.slice(1))}
                          onClick={() => setTopContentType(t)}
                          aria-pressed={topContentType === t}
                          className={`min-h-10 px-2.5 py-2 rounded-md text-sm transition-all cursor-pointer capitalize ${
                            topContentType === t
                              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                              : "text-muted-foreground hover:text-foreground font-medium"
                          }`}
                        >
                          {tr(t.charAt(0).toUpperCase() + t.slice(1))}
                        </button>
                      ))}
                    </div>
                  </div>

                  {topContent.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {tr("No traffic yet")}
                    </p>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {topContent.map((item) => (
                        <div key={item.path} className="space-y-1">
                          <div className="flex justify-between font-medium gap-2">
                            <span className="text-foreground truncate">
                              {item.path}
                            </span>
                            <span className="font-mono text-muted-foreground shrink-0">
                              {item.views.toLocaleString(locale)} {tr("views")}
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{
                                width: `${Math.round((item.views / (topContent[0]?.views || 1)) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Top Sources */}
                <Card className="p-5 border-border/70 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tr("Top Sources")}
                    </h3>
                    <span className="text-xs text-muted-foreground font-mono">
                      {tr("Referrals")}
                    </span>
                  </div>

                  {data.referrers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {tr("No traffic yet")}
                    </p>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {data.referrers.map((r) => (
                        <div
                          key={r.name}
                          className="flex items-center justify-between py-1 border-b border-border/40 last:border-b-0"
                        >
                          <span className="font-medium text-foreground flex items-center gap-2">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />{" "}
                            {r.name}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {r.views.toLocaleString(locale)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* TAB 3: NEWSLETTERS */}
          {analyticsTab === "newsletters" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 border-border/70 shadow-2xs space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    {tr("Average Open Rate")}
                  </span>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {data.newsletter.openRate.toFixed(1)}%
                  </div>
                </Card>
                <Card className="p-4 border-border/70 shadow-2xs space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    {tr("Average Click Rate")}
                  </span>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {data.newsletter.clickRate.toFixed(1)}%
                  </div>
                </Card>
                <Card className="p-4 border-border/70 shadow-2xs space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    {tr("Total Emails Sent")}
                  </span>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {data.newsletter.sent.toLocaleString(locale)}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* TAB 4: GROWTH */}
          {analyticsTab === "growth" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-5 border-border/70 shadow-2xs space-y-2">
                  <span className="text-xs text-muted-foreground font-medium">
                    {tr("Total Free Members")}
                  </span>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {data.growth.freeMembers.toLocaleString(locale)}
                  </div>
                </Card>
                <Card className="p-5 border-border/70 shadow-2xs space-y-2">
                  <span className="text-xs text-muted-foreground font-medium">
                    {tr("Total Paid Members")}
                  </span>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {data.growth.paidMembers.toLocaleString(locale)}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
