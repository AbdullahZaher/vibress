import { useEffect, useState } from 'react';
import {
  AdminComment,
  AdminCommentReport,
  AdminRecommendation,
  listCommentsApi,
  listCommentReportsApi,
  listRecommendationsApi,
} from '../lib/api';

import { MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import { CommentsPanel } from './community/CommentsPanel';
import { ReportsPanel } from './community/ReportsPanel';
import { RecommendationsPanel } from './community/RecommendationsPanel';

type Tab = 'comments' | 'reports' | 'recommendations';

export function CommunitySettings() {
  const [tab, setTab] = useState<Tab>('comments');
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [reports, setReports] = useState<AdminCommentReport[]>([]);
  const [recommendations, setRecommendations] = useState<AdminRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, r, recs] = await Promise.all([
        listCommentsApi({ limit: 50 }),
        listCommentReportsApi({ limit: 50 }),
        listRecommendationsApi(true),
      ]);
      setComments(c.comments);
      setReports(r.reports);
      setRecommendations(recs.recommendations);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load community data');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Comments & Network</h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Navigation Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTab('comments')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'comments'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" /> Comments ({comments.length})
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'reports'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" /> Reports ({reports.length})
        </button>
        <button
          onClick={() => setTab('recommendations')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === 'recommendations'
              ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" /> Recommendations ({recommendations.length})
        </button>
      </div>

      {/* Panels stay mounted so form state survives tab switches */}
      <div className={tab === 'comments' ? '' : 'hidden'}>
        <CommentsPanel comments={comments} onError={setError} onChanged={refresh} />
      </div>
      <div className={tab === 'reports' ? '' : 'hidden'}>
        <ReportsPanel reports={reports} onError={setError} onChanged={refresh} />
      </div>
      <div className={tab === 'recommendations' ? '' : 'hidden'}>
        <RecommendationsPanel recommendations={recommendations} onError={setError} onChanged={refresh} />
      </div>
    </div>
  );
}