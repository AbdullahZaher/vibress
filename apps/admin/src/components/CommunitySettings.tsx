import React, { useEffect, useState } from 'react';
import {
  AdminComment,
  AdminCommentReport,
  AdminRecommendation,
  listCommentsApi,
  hideCommentApi,
  restoreCommentApi,
  adminDeleteCommentApi,
  listCommentReportsApi,
  resolveCommentReportApi,
  listRecommendationsApi,
  createRecommendationApi,
  archiveRecommendationApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';

type Tab = 'comments' | 'reports' | 'recommendations';

export function CommunitySettings() {
  const [tab, setTab] = useState<Tab>('comments');
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [reports, setReports] = useState<AdminCommentReport[]>([]);
  const [recommendations, setRecommendations] = useState<AdminRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // New recommendation form
  const [recUrl, setRecUrl] = useState('');
  const [recTitle, setRecTitle] = useState('');
  const [recDesc, setRecDesc] = useState('');

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

  const handleHide = async (id: string) => {
    try {
      await hideCommentApi(id);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreCommentApi(id);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminDeleteCommentApi(id);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleResolveReport = async (id: string) => {
    try {
      await resolveCommentReportApi(id, 'resolved');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleCreateRec = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createRecommendationApi({ url: recUrl, title: recTitle, description: recDesc || null });
      setRecUrl('');
      setRecTitle('');
      setRecDesc('');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create recommendation');
    }
  };

  const handleArchiveRec = async (id: string) => {
    try {
      await archiveRecommendationApi(id);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

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

      {/* Tab 1: Comments */}
      {tab === 'comments' && (
        <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">Member ID</TableHead>
                <TableHead className="text-xs">Comment Content</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                    No comments found.
                  </TableCell>
                </TableRow>
              ) : (
                comments.map((c) => (
                  <TableRow key={c.id} className="hover:bg-muted/40 border-border">
                    <TableCell className="pl-6 font-mono text-xs text-foreground">
                      <div className="flex flex-col">
                        <span>{c.memberId}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-foreground max-w-md truncate">
                      {c.body}
                    </TableCell>

                    <TableCell>
                      {c.status === 'hidden' ? (
                        <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                          Hidden
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                          Visible
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.status === 'hidden' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestore(c.id)}
                            className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                          >
                            Restore
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleHide(c.id)}
                            className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                          >
                            Hide
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(c.id)}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Tab 2: Reports */}
      {tab === 'reports' && (
        <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">Reason</TableHead>
                <TableHead className="text-xs">Comment ID</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                    No pending comment reports.
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/40 border-border">
                    <TableCell className="pl-6 font-semibold text-xs text-foreground">{r.reason}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{r.commentId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      {r.status === 'open' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResolveReport(r.id)}
                          className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                        >
                          Mark Resolved
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Tab 3: Recommendations */}
      {tab === 'recommendations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                Add Recommendation
              </CardTitle>
              <CardDescription className="text-xs">
                Recommend another publication to your readers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateRec} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Publication URL</label>
                  <Input
                    required
                    type="url"
                    value={recUrl}
                    onChange={(e) => setRecUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="h-8 text-xs bg-card border-border"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Title</label>
                  <Input
                    required
                    value={recTitle}
                    onChange={(e) => setRecTitle(e.target.value)}
                    placeholder="Publication Name"
                    className="h-8 text-xs bg-card border-border"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Description (Optional)</label>
                  <Input
                    value={recDesc}
                    onChange={(e) => setRecDesc(e.target.value)}
                    placeholder="Why you recommend it..."
                    className="h-8 text-xs bg-card border-border"
                  />
                </div>
                <Button type="submit" size="sm" className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Create Recommendation
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 text-xs">Title</TableHead>
                  <TableHead className="text-xs">URL</TableHead>
                  <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recommendations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-32 text-center text-xs text-muted-foreground">
                      No recommendations added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  recommendations.map((rec) => (
                    <TableRow key={rec.id} className="hover:bg-muted/40 border-border">
                      <TableCell className="pl-6 font-semibold text-xs text-foreground">{rec.title}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-xs">{rec.url}</TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleArchiveRec(rec.id)}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          Archive
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
