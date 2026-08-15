import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Calendar,
  ChevronDown,
  Globe,
  Eye,
  Loader2,
} from "lucide-react";
import { ApiUser } from "../../lib/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
}: {
  change: { percentage: number | null; isNew: boolean };
}) {
  if (change.isNew) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] font-mono px-1.5 py-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      >
        New
      </Badge>
    );
  }
  if (change.percentage === null) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] font-mono px-1.5 py-0 bg-muted text-muted-foreground border-border"
      >
        —
      </Badge>
    );
  }
  const positive = change.percentage >= 0;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-mono px-1.5 py-0 ${
        positive
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
      }`}
    >
      {positive ? "+" : ""}
      {change.percentage}%
    </Badge>
  );
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
  const values = points.map((p) => p[metric]);
  const max = Math.max(...values, 1);
  const n = values.length;

  let path = "";
  let area = "";
  if (n > 0) {
    const coords = values.map((v, i) => {
      const x = n === 1 ? 50 : (i / (n - 1)) * 100;
      const y = 92 - (v / max) * 82;
      return { x, y };
    });
    path = coords
      .map(
        (c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)},${c.y.toFixed(1)}`,
      )
      .join(" ");
    area = `${path} L 100,100 L 0,100 Z`;
  }

  const start = points[0]?.date || "";
  const end = points[points.length - 1]?.date || "";

  return (
    <div className="pt-2">
      <div className="h-28 w-full relative">
        {n === 0 || values.every((v) => v === 0) ? (
          <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
            No traffic yet
          </div>
        ) : (
          <svg
            className="w-full h-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#grad-${color})`} />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      {start && end && (
        <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono pt-2">
          <span>{start}</span>
          <span>{end}</span>
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <p className="text-sm text-muted-foreground">Unable to load analytics</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  user,
}) => {
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Analytics
        </h1>
      </div>

      {/* Navigation Tabs & Date Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          {(["overview", "web", "newsletters", "growth"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setAnalyticsTab(t)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer capitalize ${
                analyticsTab === t
                  ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "web" ? "Web traffic" : t}
            </button>
          ))}
        </div>

        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsDateOpen(!isDateOpen)}
            className="h-8 text-xs font-medium text-foreground border-border bg-card hover:bg-accent gap-2 cursor-pointer"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{dateLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>

          {isDateOpen && (
            <div className="absolute right-0 mt-1 w-44 rounded-lg bg-card border border-border shadow-lg py-1 z-30 space-y-0.5">
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.range}
                  onClick={() => {
                    setDateLabel(opt.label);
                    setIsDateOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    dateLabel === opt.label
                      ? "bg-sidebar-accent text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
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
                <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-1">
                        <Users className="h-3.5 w-3.5" /> Members
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground">
                          {data.summary.members.toLocaleString()}
                        </span>
                        <ChangeBadge change={data.comparison.members} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAnalyticsTab("growth")}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      View details
                    </Button>
                  </div>
                  <AreaChart
                    points={data.timeseries}
                    metric="members"
                    color="#3b82f6"
                  />
                </Card>

                {/* Unique Visitors KPI Card */}
                <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-1">
                        <Globe className="h-3.5 w-3.5" /> Unique Visitors
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground">
                          {totalVisitors.toLocaleString()}
                        </span>
                        <ChangeBadge change={data.comparison.visitors} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAnalyticsTab("web")}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      View details
                    </Button>
                  </div>
                  <AreaChart
                    points={data.timeseries}
                    metric="visitors"
                    color="#10b981"
                  />
                </Card>
              </div>

              {/* Latest Post Performance */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  LATEST POST PERFORMANCE
                </h3>
                {data.latestPost ? (
                  <Card className="p-5 bg-transparent border-border shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="h-28 w-44 rounded-lg bg-neutral-950 border border-border overflow-hidden shrink-0 flex items-center justify-center relative group shadow-sm">
                        <span className="text-2xl font-serif italic font-bold tracking-tight text-neutral-300 group-hover:scale-105 transition-transform duration-300">
                          Vibress
                        </span>
                      </div>
                      <div className="space-y-1 min-w-0">
                        <h4 className="font-bold text-base text-foreground hover:text-primary transition-colors cursor-pointer truncate">
                          {data.latestPost.title}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          By {user.name} –{" "}
                          {new Date(
                            data.latestPost.publishedAt,
                          ).toLocaleDateString()}
                        </p>
                        <div className="pt-1">
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          >
                            Published
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-row md:flex-col gap-6 md:gap-3 text-xs text-muted-foreground font-mono self-start md:self-center border-t md:border-t-0 border-border pt-4 md:pt-0 w-full md:w-auto justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-emerald-500" />
                        <span>Views</span>
                        <span className="font-bold text-foreground text-sm ml-auto">
                          {data.latestPost.views.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </Card>
                ) : (
                  <Card className="p-5 bg-transparent border-border shadow-2xs text-xs text-muted-foreground">
                    No published posts yet.
                  </Card>
                )}
              </div>

              {/* Top Posts in the period */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  TOP POSTS IN THE LAST 30 DAYS
                </h3>
                {data.topPosts.length === 0 ? (
                  <Card className="p-5 bg-transparent border-border shadow-2xs text-xs text-muted-foreground">
                    No traffic yet.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {data.topPosts.map((post, idx) => (
                      <Card
                        key={post.path}
                        className="p-4 bg-transparent border-border shadow-2xs flex items-center justify-between hover:border-sidebar-border transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <span className="text-xs font-mono font-bold text-muted-foreground w-4">
                            {idx + 1}
                          </span>
                          <div className="h-10 w-14 rounded bg-neutral-950 border border-border flex items-center justify-center shrink-0">
                            <span className="text-xs font-serif italic text-neutral-300">
                              #{idx + 1}
                            </span>
                          </div>
                          <div className="truncate">
                            <h4 className="font-bold text-xs text-foreground truncate">
                              {post.title}
                            </h4>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {post.path}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-xs text-muted-foreground font-mono shrink-0 ml-4">
                          <div className="flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5" />{" "}
                            <span>{formatCompact(post.views)}</span>
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
              <Card className="p-6 bg-transparent border-border shadow-2xs space-y-6">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setTrafficMetric("views")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                      trafficMetric === "views"
                        ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Total views ({formatCompact(totalViews)})
                  </button>
                  <button
                    onClick={() => setTrafficMetric("visitors")}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                      trafficMetric === "visitors"
                        ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Unique visitors ({formatCompact(totalVisitors)})
                  </button>
                </div>

                <AreaChart
                  points={data.timeseries}
                  metric={trafficMetric}
                  color="#6366f1"
                />
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Content */}
                <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-foreground">
                      Top Content
                    </h3>
                    <div className="flex items-center gap-1">
                      {(["all", "posts", "pages"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setTopContentType(t)}
                          className={`px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer capitalize ${
                            topContentType === t
                              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                              : "text-muted-foreground hover:text-foreground font-medium"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {topContent.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No traffic yet
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
                              {item.views.toLocaleString()} views
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
                <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-foreground">
                      Top Sources
                    </h3>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      Referrals
                    </span>
                  </div>

                  {data.referrers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No traffic yet
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
                            {r.views.toLocaleString()}
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
                <Card className="p-4 bg-transparent border-border shadow-2xs space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    Average Open Rate
                  </span>
                  <div className="text-2xl font-bold text-foreground">
                    {data.newsletter.openRate.toFixed(1)}%
                  </div>
                </Card>
                <Card className="p-4 bg-transparent border-border shadow-2xs space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    Average Click Rate
                  </span>
                  <div className="text-2xl font-bold text-foreground">
                    {data.newsletter.clickRate.toFixed(1)}%
                  </div>
                </Card>
                <Card className="p-4 bg-transparent border-border shadow-2xs space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    Total Emails Sent
                  </span>
                  <div className="text-2xl font-bold text-foreground">
                    {data.newsletter.sent.toLocaleString()}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* TAB 4: GROWTH */}
          {analyticsTab === "growth" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-5 bg-transparent border-border shadow-2xs space-y-2">
                  <span className="text-xs text-muted-foreground font-medium">
                    Total Free Members
                  </span>
                  <div className="text-2xl font-bold text-foreground">
                    {data.growth.freeMembers.toLocaleString()}
                  </div>
                </Card>
                <Card className="p-5 bg-transparent border-border shadow-2xs space-y-2">
                  <span className="text-xs text-muted-foreground font-medium">
                    Total Paid Members
                  </span>
                  <div className="text-2xl font-bold text-foreground">
                    {data.growth.paidMembers.toLocaleString()}
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
