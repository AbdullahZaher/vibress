import React, { useState } from 'react';
import {
  Users,
  Calendar,
  ChevronDown,
  Share,
  BarChart3,
  Globe,
  Eye,
} from 'lucide-react';
import { ApiUser } from '../../lib/api';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface AnalyticsDashboardProps {
  user: ApiUser;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ user }) => {
  const [analyticsTab, setAnalyticsTab] = useState<'overview' | 'web' | 'newsletters' | 'growth'>('overview');
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [trafficMetric, setTrafficMetric] = useState<'views' | 'visitors'>('views');
  const [topContentType, setTopContentType] = useState<'all' | 'posts' | 'pages'>('all');

  const dateOptions = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'Year to date'];

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Page Title Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Analytics</h1>
      </div>

      {/* Navigation Tabs & Date Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Vibress Analytics Main Tabs */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAnalyticsTab('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              analyticsTab === 'overview'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setAnalyticsTab('web')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              analyticsTab === 'web'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Web traffic
          </button>
          <button
            onClick={() => setAnalyticsTab('newsletters')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              analyticsTab === 'newsletters'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Newsletters
          </button>
          <button
            onClick={() => setAnalyticsTab('growth')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              analyticsTab === 'growth'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Growth
          </button>
        </div>

        {/* Date Range Selector Dropdown */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsDateOpen(!isDateOpen)}
            className="h-8 text-xs font-medium text-foreground border-border bg-card hover:bg-accent gap-2 cursor-pointer"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{dateRange}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>

          {isDateOpen && (
            <div className="absolute right-0 mt-1 w-44 rounded-lg bg-card border border-border shadow-lg py-1 z-30 space-y-0.5">
              {dateOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    setDateRange(opt);
                    setIsDateOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    dateRange === opt
                      ? 'bg-sidebar-accent text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {analyticsTab === 'overview' && (
        <div className="space-y-8">
          {/* Dual KPI Cards (Members & Unique Visitors) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Members KPI Card */}
            <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-1">
                    <Users className="h-3.5 w-3.5" /> Members
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-foreground">1,482</span>
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      +12.4%
                    </Badge>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAnalyticsTab('growth')} className="h-7 text-xs text-muted-foreground hover:text-foreground">
                  View details
                </Button>
              </div>

              {/* Members Area SVG Chart */}
              <div className="pt-2">
                <div className="h-28 w-full relative">
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 400 100" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="membersGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 0,80 Q 50,75 100,60 T 200,45 T 300,25 T 400,10 L 400,100 L 0,100 Z"
                      fill="url(#membersGrad)"
                    />
                    <path
                      d="M 0,80 Q 50,75 100,60 T 200,45 T 300,25 T 400,10"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
                <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono pt-2">
                  <span>10 Jul</span>
                  <span>9 Aug</span>
                </div>
              </div>
            </Card>

            {/* Unique Visitors KPI Card */}
            <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-1">
                    <Globe className="h-3.5 w-3.5" /> Unique Visitors
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-foreground">24,910</span>
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      +18.7%
                    </Badge>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAnalyticsTab('web')} className="h-7 text-xs text-muted-foreground hover:text-foreground">
                  View details
                </Button>
              </div>

              {/* Visitors Area SVG Chart */}
              <div className="pt-2">
                <div className="h-28 w-full relative">
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 400 100" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="visitorsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 0,90 Q 60,65 120,70 T 240,35 T 320,40 T 400,15 L 400,100 L 0,100 Z"
                      fill="url(#visitorsGrad)"
                    />
                    <path
                      d="M 0,90 Q 60,65 120,70 T 240,35 T 320,40 T 400,15"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
                <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono pt-2">
                  <span>10 Jul</span>
                  <span>9 Aug</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Section: Latest Post Performance */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              LATEST POST PERFORMANCE
            </h3>
            <Card className="p-5 bg-transparent border-border shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                {/* Post Thumbnail */}
                <div className="h-28 w-44 rounded-lg bg-neutral-950 border border-border overflow-hidden shrink-0 flex items-center justify-center relative group shadow-sm">
                  <span className="text-2xl font-serif italic font-bold tracking-tight text-neutral-300 group-hover:scale-105 transition-transform duration-300">
                    Vibress
                  </span>
                </div>

                {/* Post Info */}
                <div className="space-y-1">
                  <h4 className="font-bold text-base text-foreground hover:text-primary transition-colors cursor-pointer">
                    Welcome to Vibress: The Future of Autonomous Publishing
                  </h4>
                  <p className="text-xs text-muted-foreground">By {user.name} – 7 Aug</p>
                  <div className="pt-1">
                    <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      Published
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 pt-3">
                    <Button variant="outline" size="sm" className="h-8 text-xs font-semibold gap-1.5 border-border bg-card hover:bg-accent text-foreground">
                      <Share className="h-3.5 w-3.5" /> Share post
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs font-semibold gap-1.5 border-border bg-card hover:bg-accent text-foreground">
                      <BarChart3 className="h-3.5 w-3.5" /> Analytics
                    </Button>
                  </div>
                </div>
              </div>

              {/* Conversion Stats */}
              <div className="flex flex-row md:flex-col gap-6 md:gap-3 text-xs text-muted-foreground font-mono self-start md:self-center border-t md:border-t-0 border-border pt-4 md:pt-0 w-full md:w-auto justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-emerald-500" />
                  <span>Visitors</span>
                  <span className="font-bold text-foreground text-sm ml-auto">3,840</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-500" />
                  <span>Members</span>
                  <span className="font-bold text-foreground text-sm ml-auto">142</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Section: Top Posts in the Last 30 Days */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              TOP POSTS IN THE LAST 30 DAYS
            </h3>
            <div className="space-y-2">
              <Card className="p-4 bg-transparent border-border shadow-2xs flex items-center justify-between hover:border-sidebar-border transition-colors">
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="text-xs font-mono font-bold text-muted-foreground w-4">1</span>
                  <div className="h-10 w-14 rounded bg-neutral-950 border border-border flex items-center justify-center shrink-0">
                    <span className="text-xs font-serif italic text-neutral-300">#1</span>
                  </div>
                  <div className="truncate">
                    <h4 className="font-bold text-xs text-foreground truncate">Welcome to Vibress: The Future of Autonomous Publishing</h4>
                    <p className="text-[11px] text-muted-foreground truncate">By {user.name} – 7 Aug · Published</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs text-muted-foreground font-mono shrink-0 ml-4">
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> <span>3.8k</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-indigo-400" /> <span className="font-bold text-foreground">142</span>
                  </div>
                </div>
              </Card>

              <Card className="p-4 bg-transparent border-border shadow-2xs flex items-center justify-between hover:border-sidebar-border transition-colors">
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="text-xs font-mono font-bold text-muted-foreground w-4">2</span>
                  <div className="h-10 w-14 rounded bg-neutral-950 border border-border flex items-center justify-center shrink-0">
                    <span className="text-xs font-serif italic text-neutral-300">#2</span>
                  </div>
                  <div className="truncate">
                    <h4 className="font-bold text-xs text-foreground truncate">Building High-Performance Web Applications in Monorepos</h4>
                    <p className="text-[11px] text-muted-foreground truncate">By {user.name} – 2 Aug · Published</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs text-muted-foreground font-mono shrink-0 ml-4">
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> <span>2.1k</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-indigo-400" /> <span className="font-bold text-foreground">89</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WEB TRAFFIC */}
      {analyticsTab === 'web' && (
        <div className="space-y-6">
          <Card className="p-6 bg-transparent border-border shadow-2xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Traffic Metric Switcher */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setTrafficMetric('views')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                    trafficMetric === 'views'
                      ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Total views (34,120)
                </button>
                <button
                  onClick={() => setTrafficMetric('visitors')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all cursor-pointer ${
                    trafficMetric === 'visitors'
                      ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Unique visitors (24,910)
                </button>
              </div>
            </div>

            {/* Web Traffic Graph Area */}
            <div className="h-56 w-full relative pt-4">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 500 120" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="webTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M 0,100 C 50,80 100,90 150,50 C 200,60 250,30 300,45 C 350,20 400,30 500,10 L 500,120 L 0,120 Z"
                  fill="url(#webTrafficGrad)"
                />
                <path
                  d="M 0,100 C 50,80 100,90 150,50 C 200,60 250,30 300,45 C 350,20 400,30 500,10"
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="2.5"
                />
              </svg>
              <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono pt-3 px-1 border-t border-border">
                <span>10 Jul</span>
                <span>20 Jul</span>
                <span>30 Jul</span>
                <span>9 Aug</span>
              </div>
            </div>
          </Card>

          {/* Web Traffic Grid: Top Content & Top Sources */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top Content Card */}
            <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground">Top Content</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTopContentType('all')}
                    className={`px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer ${
                      topContentType === 'all'
                        ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground font-medium'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setTopContentType('posts')}
                    className={`px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer ${
                      topContentType === 'posts'
                        ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground font-medium'
                    }`}
                  >
                    Posts
                  </button>
                  <button
                    onClick={() => setTopContentType('pages')}
                    className={`px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer ${
                      topContentType === 'pages'
                        ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground font-medium'
                    }`}
                  >
                    Pages
                  </button>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between font-medium">
                    <span className="text-foreground truncate">/welcome-to-vibress</span>
                    <span className="font-mono text-muted-foreground">18,420 views</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: '75%' }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-medium">
                    <span className="text-foreground truncate">/building-high-performance-monorepos</span>
                    <span className="font-mono text-muted-foreground">10,110 views</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: '45%' }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-medium">
                    <span className="text-foreground truncate">/about</span>
                    <span className="font-mono text-muted-foreground">5,590 views</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: '25%' }} />
                  </div>
                </div>
              </div>
            </Card>

            {/* Top Sources Card */}
            <Card className="p-5 bg-transparent border-border shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground">Top Sources</h3>
                <span className="text-[11px] text-muted-foreground font-mono">Referrals</span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="font-medium text-foreground flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Direct / None
                  </span>
                  <span className="font-mono text-muted-foreground">14,200</span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="font-medium text-foreground flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Google Search
                  </span>
                  <span className="font-mono text-muted-foreground">6,840</span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="font-medium text-foreground flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" /> X / Twitter
                  </span>
                  <span className="font-mono text-muted-foreground">2,510</span>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="font-medium text-foreground flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" /> GitHub / Docs
                  </span>
                  <span className="font-mono text-muted-foreground">1,360</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 3: NEWSLETTERS */}
      {analyticsTab === 'newsletters' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-transparent border-border shadow-2xs space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Average Open Rate</span>
              <div className="text-2xl font-bold text-foreground">64.2%</div>
            </Card>
            <Card className="p-4 bg-transparent border-border shadow-2xs space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Average Click Rate</span>
              <div className="text-2xl font-bold text-foreground">18.5%</div>
            </Card>
            <Card className="p-4 bg-transparent border-border shadow-2xs space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Total Emails Sent</span>
              <div className="text-2xl font-bold text-foreground">1,240</div>
            </Card>
          </div>

          <div className="space-y-3">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              RECENT NEWSLETTER BROADCASTS
            </h3>
            <Card className="p-4 bg-transparent border-border shadow-2xs flex items-center justify-between">
              <div className="space-y-0.5">
                <h4 className="font-bold text-xs text-foreground">Issue #12: Monorepo Architecture Best Practices</h4>
                <p className="text-[11px] text-muted-foreground">Sent 4 Aug · 620 recipients</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-emerald-500 font-semibold">68% open</span>
                <span className="text-indigo-400 font-semibold">22% click</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 4: GROWTH */}
      {analyticsTab === 'growth' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5 bg-transparent border-border shadow-2xs space-y-2">
              <span className="text-xs text-muted-foreground font-medium">Total Free Members</span>
              <div className="text-2xl font-bold text-foreground">1,340</div>
            </Card>
            <Card className="p-5 bg-transparent border-border shadow-2xs space-y-2">
              <span className="text-xs text-muted-foreground font-medium">Total Paid Members</span>
              <div className="text-2xl font-bold text-foreground">142</div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
