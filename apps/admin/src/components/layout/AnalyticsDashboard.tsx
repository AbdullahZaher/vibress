import React, { useMemo, useState } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ChevronDown,
  Globe,
  Eye,
  FileText,
  ChartNoAxesCombined,
} from "lucide-react";
import { ApiUser, apiRequest } from "../../lib/api";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ToggleButton } from "../ui/toggle-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { AdminPageHeader } from "../common/AdminPageHeader";
import {
  getAnalyticsOverviewApi,
  AnalyticsRange,
  AnalyticsOverview,
  AnalyticsTimeseriesPoint,
} from "../../lib/api/analytics";

interface AnalyticsDashboardProps {
  user: ApiUser;
  onNavigate: (path: string) => void;
  canReadAnalytics: boolean;
  canReadPosts: boolean;
  canEditPosts?: boolean;
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
        className="text-xs font-medium px-2 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
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
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
          : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
      }`}
    >
      {positive ? "+" : ""}
      {formatNumber(change.percentage)}%
    </Badge>
  );
}

function displayAnalyticsDate(value: string, locale: string, showYear = false) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-US", {
    day: "numeric", month: "short",
    ...(showYear ? { year: "numeric" as const } : {}),
    ...(isDateOnly ? { timeZone: "UTC" } : {}),
  }).format(date);
}

/**
 * Compact, keyboard-explorable area chart. The SVG is visual only: one keyboard
 * stop per chart and a complete semantic data table keep 90-day views usable.
 */
function AreaChart({
  points,
  metric,
  color,
  size = "compact",
}: {
  points: AnalyticsTimeseriesPoint[];
  metric: "views" | "visitors" | "members";
  color: "green" | "blue";
  size?: "compact" | "large";
}) {
  const { tr, locale, formatNumber } = useAdminLocale();
  const [showData, setShowData] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = React.useId();
  const metricLabel = tr(metric === "members" ? "New members" : metric);
  const values = points.map((point) => point[metric]);
  const max = Math.max(1, ...values);
  const ceiling = Math.ceil(max / 4) * 4;
  const hasData = values.some((value) => value > 0);
  const coords = values.map((value, index) => ({
    x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
    y: 96 - (value / ceiling) * 90,
  }));
  const line = coords.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join(" ");
  const area = coords.length ? `${line} L 100 100 L 0 100 Z` : "";
  const start = points[0]?.date;
  const end = points[points.length - 1]?.date;
  const crossesYear = Boolean(start && end && start.slice(0, 4) !== end.slice(0, 4));
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeCoord = activeIndex === null ? null : coords[activeIndex];

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    // Touch users can tap to inspect a date without disabling page scrolling.
    if (event.type === "pointermove" && event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    setActiveIndex(Math.round(fraction * Math.max(0, points.length - 1)));
  };

  const handleChartKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = activeIndex ?? points.length - 1;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? points.length - 1
      : current + (event.key === "ArrowRight" ? 1 : -1);
    setActiveIndex(Math.min(points.length - 1, Math.max(0, next)));
  };

  if (!hasData) {
    return (
      <div role="status" className="flex min-h-24 items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-3">
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
      <div className="flex items-stretch gap-3" dir="ltr">
        <div aria-hidden="true" className={`flex shrink-0 flex-col justify-between text-end text-xs tabular-nums text-muted-foreground ${size === "large" ? "h-52 sm:h-60" : "h-36 sm:h-44"}`}>
          {[ceiling, ceiling * 0.75, ceiling * 0.5, ceiling * 0.25, 0].map((tick) => (
            <span key={tick}>{formatNumber(tick)}</span>
          ))}
        </div>
        <div
          className={`relative min-w-0 flex-1 cursor-crosshair rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${color === "blue" ? "text-blue-700 dark:text-blue-400" : "text-emerald-700 dark:text-emerald-400"} ${size === "large" ? "h-52 sm:h-60" : "h-36 sm:h-44"}`}
          role="group"
          tabIndex={0}
          aria-label={`${tr("Activity trend")}: ${metricLabel}. ${tr("Use arrow keys to inspect daily values.")}`}
          onFocus={() => setActiveIndex((current) => current ?? points.length - 1)}
          onBlur={() => setActiveIndex(null)}
          onKeyDown={handleChartKeys}
          onPointerDown={handlePointer}
          onPointerMove={handlePointer}
          onPointerLeave={() => setActiveIndex(null)}
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3, 4].map((tick) => <span key={tick} className="w-full border-t border-border/60" />)}
          </div>
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradientId})`} />
            <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {activeCoord && (
              <>
                <line x1={activeCoord.x} x2={activeCoord.x} y1="0" y2="100" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </>
            )}
          </svg>
          {activeCoord && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card shadow-sm"
              style={{ left: `${activeCoord.x}%`, top: `${activeCoord.y}%`, backgroundColor: "currentColor" }}
            />
          )}
          {activePoint && activeCoord && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute top-1 z-10 box-border w-max min-w-0 break-words rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground shadow-md"
              style={{
                left: `${activeCoord.x}%`,
                maxWidth: `${activeCoord.x <= 50 ? 100 - activeCoord.x : activeCoord.x}%`,
                transform: activeCoord.x <= 50 ? "translateX(0)" : "translateX(-100%)",
              }}
            >
              <span className="block text-muted-foreground">{displayAnalyticsDate(activePoint.date, locale, true)}</span>
              <strong className="block text-sm tabular-nums">{formatNumber(activePoint[metric])} {metricLabel}</strong>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 tabular-nums" dir="ltr">
          {start && <time dateTime={start}>{displayAnalyticsDate(start, locale, crossesYear)}</time>}
          {end && <><span aria-hidden="true">—</span><time dateTime={end}>{displayAnalyticsDate(end, locale, crossesYear)}</time></>}
        </div>
        <button
          type="button"
          aria-expanded={showData}
          onClick={() => setShowData((open) => !open)}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {showData ? tr("Hide data") : tr("View data")}
        </button>
      </div>
      {showData && (
        <div className="max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{tr("Activity trend")}: {metricLabel}</caption>
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{tr("Date")}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{metricLabel}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={`${point.date}-${index}`} className="border-t border-border/60">
                  <td className="px-3 py-2 tabular-nums"><time dateTime={point.date}>{displayAnalyticsDate(point.date, locale, true)}</time></td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(point[metric])}</td>
                </tr>
              ))}
            </tbody>
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

/** Only internal publication routes may become public content links. */
function isSafePublicPath(path: string): boolean {
  return /^\/(?!\/)[^\r\n]*$/.test(path);
}

/** Period metrics and all-time totals must never share an unlabeled denominator. */
function MetricCard({
  label,
  value,
  scope,
  change,
}: {
  label: string;
  value: number;
  scope: string;
  change?: { percentage: number | null; isNew: boolean };
}) {
  const { formatNumber, tr } = useAdminLocale();
  return (
    <Card className="flex min-w-0 flex-col justify-between gap-3 border-border/70 p-5 shadow-2xs">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <strong className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{formatNumber(value)}</strong>
        {change && <ChangeBadge change={change} current={value} />}
      </div>
      <span className="text-xs text-muted-foreground">
        {scope}{change ? ` · ${tr("Compared with previous period")}` : ""}
      </span>
    </Card>
  );
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  user,
  onNavigate,
  canReadAnalytics,
  canReadPosts,
  canEditPosts = false,
}) => {
  const { tr, locale, formatDate, formatNumber } = useAdminLocale();
  const [analyticsTab, setAnalyticsTab] = useState<
    "overview" | "web" | "newsletters" | "growth"
  >("overview");
  const [dateLabel, setDateLabel] = useState("Last 30 days");
  const [trafficMetric, setTrafficMetric] = useState<"views" | "visitors">("views");
  const [overviewMetric, setOverviewMetric] = useState<"views" | "visitors" | "members">("views");
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
    enabled: canReadAnalytics,
    staleTime: 60 * 1000,
  });

  const editorialQueueQuery = useQuery({
    queryKey: ["dashboard", "editorial-queue", user.id],
    queryFn: async () => {
      const [drafts, review, scheduled] = await Promise.all([
        apiRequest<{ total: number }>("/posts?status=draft&limit=1"),
        apiRequest<{ total: number }>("/posts?status=in_review&limit=1"),
        apiRequest<{ total: number }>("/posts?status=scheduled&limit=1"),
      ]);
      return {
        drafts: drafts.total || 0,
        review: review.total || 0,
        scheduled: scheduled.total || 0,
      };
    },
    enabled: canReadPosts,
    staleTime: 30 * 1000,
  });

  const data: AnalyticsOverview | undefined = overviewQuery.data;

  const topContent = useMemo(() => {
    if (!data) return [];
    if (topContentType === "all") return data.topContent;
    return data.topContent.filter((c) => c.type === (topContentType === "posts" ? "post" : "page"));
  }, [data, topContentType]);

  const totalViews = data?.summary.views ?? 0;
  const totalVisitors = data?.summary.visitors ?? 0;
  const maxTopContentViews = Math.max(1, ...topContent.map((item) => item.views));
  const paidMemberShare = data?.summary.members ? Math.min(100, (data.growth.paidMembers / data.summary.members) * 100) : 0;

  return (
    <Tabs value={analyticsTab} onValueChange={(value) => setAnalyticsTab(value as typeof analyticsTab)} className="mx-auto w-full max-w-7xl min-w-0 space-y-8">
      {/* Page Title Header */}
      <AdminPageHeader
        title={tr("Dashboard")}
        description={tr("Your editorial workspace at a glance.")}
      />

      {/* Editorial work queue: show the next operational actions before analytics. */}
      {canReadPosts && (
        <section className="space-y-3" aria-labelledby="editorial-work-queue-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="space-y-1">
              <h2 id="editorial-work-queue-title" className="text-base font-semibold tracking-tight text-foreground">{tr("Editorial workflow")}</h2>
              <p className="text-sm text-muted-foreground">{tr("Items that need attention")}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" className="min-h-10" onClick={() => onNavigate("/admin/posts")}>
              {tr("View all posts")}
            </Button>
          </div>
          {editorialQueueQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-border/70 bg-card" />)}
            </div>
          ) : editorialQueueQuery.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">{tr("Unable to load editorial tasks")}</p>
              <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => void editorialQueueQuery.refetch()}>{tr("Retry")}</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {([
                { key: "review", label: "In review", description: "Content waiting for editorial review", count: editorialQueueQuery.data?.review ?? 0, path: "/admin/posts/review", icon: <Eye className="size-4" aria-hidden="true" /> },
                { key: "drafts", label: "Drafts", description: "Unpublished posts in progress", count: editorialQueueQuery.data?.drafts ?? 0, path: "/admin/posts/drafts", icon: <FileText className="size-4" aria-hidden="true" /> },
                { key: "scheduled", label: "Scheduled", description: "Posts queued for publication", count: editorialQueueQuery.data?.scheduled ?? 0, path: "/admin/posts/scheduled", icon: <Calendar className="size-4" aria-hidden="true" /> },
              ]).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className="group flex min-h-32 min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-card p-5 text-start transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    {item.icon}
                    {tr(item.label)}
                  </span>
                  <span className="flex items-end justify-between gap-3">
                    <span className="min-w-0 space-y-1">
                      <span className="block text-3xl font-semibold tabular-nums tracking-tight text-foreground">{formatNumber(item.count)}</span>
                      <span className="block text-sm leading-relaxed text-muted-foreground">{tr(item.description)}</span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-foreground underline-offset-4 group-hover:underline">{tr("Open")}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Navigation Tabs & Date Filter Bar */}
      {canReadAnalytics && <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <TabsList className="w-full min-w-0 max-w-full border-0 bg-transparent p-0 sm:w-auto" ariaLabel={tr("Analytics")}>
          {(["overview", "web", "newsletters", "growth"] as const).map((t) => (
            <TabsTrigger key={t} value={t} className="min-h-11 shrink-0 px-3.5">
              {tr(t === "web" ? "Web traffic" : t.charAt(0).toUpperCase() + t.slice(1))}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="relative w-full shrink-0 sm:w-auto">
          <Calendar className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <select
            aria-label={tr("Date range")}
            value={dateLabel}
            onChange={(event) => setDateLabel(event.target.value)}
            className="min-h-11 w-full appearance-none rounded-lg border border-border/80 bg-card py-2 pe-10 ps-10 text-sm font-medium text-foreground transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto cursor-pointer"
          >
            {DATE_OPTIONS.map((opt) => (
              <option key={opt.range} value={opt.label}>{tr(opt.label)}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>}

      {!canReadAnalytics && !canReadPosts && (
        <Card className="border-border/70 p-5 text-sm text-muted-foreground">
          {tr("No dashboard data is available for your role.")}
        </Card>
      )}

      {canReadAnalytics && overviewQuery.isLoading && <LoadingState />}
      {canReadAnalytics && overviewQuery.isError && (
        <ErrorState onRetry={() => overviewQuery.refetch()} />
      )}

      {canReadAnalytics && overviewQuery.isSuccess && data && (
        <>
          {/* TAB 1: OVERVIEW */}
          <TabsContent value="overview" className="mt-0 space-y-8">
              <section className="space-y-4" aria-labelledby="performance-overview-title">
                <div className="space-y-1">
                  <h2 id="performance-overview-title" className="text-base font-semibold tracking-tight text-foreground">{tr("Performance overview")}</h2>
                  <p className="text-sm text-muted-foreground">{tr("Key metrics for the selected period.")}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label={tr("Total views")} value={totalViews} scope={tr("Selected period")} change={data.comparison.views} />
                  <MetricCard label={tr("Unique Visitors")} value={totalVisitors} scope={tr("Selected period")} change={data.comparison.visitors} />
                  <MetricCard label={tr("New members")} value={data.comparison.members.current} scope={tr("Selected period")} change={data.comparison.members} />
                  <MetricCard label={tr("Current members")} value={data.summary.members} scope={tr("Current total")} />
                </div>
                <Card className="space-y-5 border-border/70 p-4 shadow-2xs sm:p-6">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">{tr("Views and visitors over time")}</h3>
                      <p className="text-xs text-muted-foreground">{tr("Daily activity")} · {tr(dateLabel)}</p>
                    </div>
                    <div role="group" className="flex max-w-full flex-wrap gap-1.5" aria-label={tr("Traffic and audience")}>
                      {(["views", "visitors", "members"] as const).map((metric) => (
                        <ToggleButton
                          key={metric}
                          pressed={overviewMetric === metric}
                          onClick={() => setOverviewMetric(metric)}
                        >
                          {tr(metric === "members" ? "New members" : metric)}
                        </ToggleButton>
                      ))}
                    </div>
                  </div>
                  <AreaChart
                    points={data.timeseries}
                    metric={overviewMetric}
                    color={overviewMetric === "members" ? "blue" : "green"}
                    size="large"
                  />
                </Card>
              </section>

              {/* Latest Post Performance */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">{tr("Latest post performance")}</h3>
                  {canEditPosts && data.latestPost && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate(`/admin/posts/${data.latestPost!.id}`)}>
                      {tr("Open published post")}
                    </Button>
                  )}
                </div>
                {data.latestPost ? (
                  <Card className="flex flex-col items-start justify-between gap-4 border-border/80 p-5 md:flex-row md:items-center shadow-2xs">
                    <div className="flex items-center gap-4 min-w-0">
                      <div aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground border border-border/60">
                        <FileText className="size-5 text-foreground" />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <h4 dir="auto" className="truncate text-base font-semibold text-foreground">
                          {data.latestPost.title}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {tr("Published")} · {formatDate(data.latestPost.publishedAt, { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                        <div>
                          <Badge variant="published">
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
                            {isSafePublicPath(post.path) ? (
                              <a href={post.path} target="_blank" rel="noopener noreferrer" dir="auto" className="block truncate rounded-sm text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={tr("Open published post")}>
                                {post.title}
                              </a>
                            ) : (
                              <h4 className="truncate text-sm font-semibold text-foreground" dir="auto">{post.title}</h4>
                            )}
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
          </TabsContent>

          {/* TAB 2: WEB TRAFFIC */}
          <TabsContent value="web" className="mt-0 space-y-6">
              <Card className="p-6 border-border/70 shadow-2xs space-y-6">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ToggleButton pressed={trafficMetric === "views"} onClick={() => setTrafficMetric("views")}>
                    {tr("Total views")} ({formatNumber(totalViews, { notation: "compact", maximumFractionDigits: 1 })})
                  </ToggleButton>
                  <ToggleButton pressed={trafficMetric === "visitors"} onClick={() => setTrafficMetric("visitors")}>
                    {tr("Unique visitors")} ({formatNumber(totalVisitors, { notation: "compact", maximumFractionDigits: 1 })})
                  </ToggleButton>
                </div>

                <AreaChart
                  points={data.timeseries}
                  metric={trafficMetric}
                  color="green"
                  size="large"
                />
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Content */}
                <Card className="p-5 border-border/70 shadow-2xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {tr("Top Content")}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1">
                      {(["all", "posts", "pages"] as const).map((t) => (
                        <ToggleButton
                          key={t}
                          pressed={topContentType === t}
                          onClick={() => setTopContentType(t)}
                        >
                          {tr(t.charAt(0).toUpperCase() + t.slice(1))}
                        </ToggleButton>
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
                            {isSafePublicPath(item.path) ? (
                              <a href={item.path} target="_blank" rel="noopener noreferrer" dir="auto" className="truncate rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={tr("Open published content")}>
                                {item.title || item.path}
                              </a>
                            ) : <span className="truncate text-foreground" dir="auto">{item.title || item.path}</span>}
                            <span className="font-mono text-muted-foreground shrink-0">
                              {item.views.toLocaleString(locale)} {tr("views")}
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-700 dark:bg-blue-400 rounded-full"
                              style={{
                                width: `${Math.round((item.views / maxTopContentViews) * 100)}%`,
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
                          <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                            <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{" "}
                            <span className="min-w-0 truncate" dir="auto" title={r.name}>{r.name}</span>
                          </span>
                          <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                            {r.views.toLocaleString(locale)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
          </TabsContent>

          {/* TAB 3: NEWSLETTERS */}
          <TabsContent value="newsletters" className="mt-0 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">{tr("Newsletter performance")}</h2>
                <p className="text-sm text-muted-foreground">{tr("Newsletter metrics reflect the selected date range.")} · {tr(dateLabel)}</p>
              </div>
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
          </TabsContent>

          {/* TAB 4: GROWTH */}
          <TabsContent value="growth" className="mt-0 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">{tr("Member acquisition")}</h2>
                <p className="text-sm text-muted-foreground">{tr("Membership totals are current and not limited by the date filter.")}</p>
              </div>
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
          </TabsContent>
        </>
      )}
    </Tabs>
  );
};
