import React, { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Plus, Search, FileText, Edit, Trash2, Globe, EyeOff, Calendar } from 'lucide-react';

interface PostSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  scheduledAt: string | null;
  updatedAt: string;
  authors?: Array<{ name: string; email: string }>;
}

interface PostsListProps {
  onNavigate: (path: string) => void;
  canPublish: boolean;
  filterStatus?: string;
}

export const PostsList: React.FC<PostsListProps> = ({ onNavigate, canPublish, filterStatus }) => {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(filterStatus || 'all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchPosts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ posts: PostSummary[] }>('/posts');
      setPosts(data.posts || []);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setError(errorObj.message || 'Failed to fetch posts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  const handlePublishToggle = async (post: PostSummary) => {
    if (!canPublish) return;
    try {
      const endpoint = post.status === 'published' ? `/posts/${post.id}/unpublish` : `/posts/${post.id}/publish`;
      await apiRequest(endpoint, { method: 'POST' });
      fetchPosts();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || 'Action failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      await apiRequest(`/posts/${id}`, { method: 'DELETE' });
      fetchPosts();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || 'Delete failed');
    }
  };

  const filteredPosts = posts.filter((post) => {
    const matchesStatus = statusFilter === 'all' || post.status === statusFilter;
    const matchesSearch =
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.slug.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1">
            <Globe className="h-3 w-3" /> Published
          </Badge>
        );
      case 'scheduled':
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1">
            <Calendar className="h-3 w-3" /> Scheduled
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border gap-1">
            <EyeOff className="h-3 w-3" /> Draft
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Loading publication posts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Posts</h1>
        <Button
          onClick={() => onNavigate('/admin/posts/new')}
          className="h-9 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Create Post
        </Button>
      </div>

      {/* Filter Tabs Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({posts.length})
          </button>
          <button
            onClick={() => setStatusFilter('published')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'published'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Published ({posts.filter((p) => p.status === 'published').length})
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'draft'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Drafts ({posts.filter((p) => p.status === 'draft').length})
          </button>
          <button
            onClick={() => setStatusFilter('scheduled')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'scheduled'
                ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Scheduled ({posts.filter((p) => p.status === 'scheduled').length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Filter posts by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs bg-card border-border"
          />
        </div>
      </div>

      {/* Table Container Card */}
      <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Title</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Author</TableHead>
              <TableHead className="text-xs">Updated</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPosts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-36 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <FileText className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-xs font-medium">No posts found matching filter criteria.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredPosts.map((post) => (
                <TableRow key={post.id} className="hover:bg-muted/40 border-border">
                  <TableCell className="pl-6 font-medium">
                    <div className="flex flex-col">
                      <button
                        onClick={() => onNavigate(`/admin/posts/${post.id}`)}
                        className="text-left font-semibold text-foreground hover:text-primary transition-colors cursor-pointer text-xs"
                      >
                        {post.title}
                      </button>
                      <span className="text-[11px] text-muted-foreground font-mono">/{post.slug}</span>
                    </div>
                  </TableCell>

                  <TableCell>{getStatusBadge(post.status)}</TableCell>

                  <TableCell className="text-xs text-muted-foreground font-medium">
                    {post.authors?.[0]?.name || 'Admin'}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {new Date(post.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>

                  <TableCell className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigate(`/admin/posts/${post.id}`)}
                        className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <Edit className="h-3.5 w-3.5" /> Edit
                      </Button>

                      {canPublish && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePublishToggle(post)}
                          className="h-7 px-2.5 text-xs border-border bg-card hover:bg-accent text-foreground cursor-pointer"
                        >
                          {post.status === 'published' ? 'Unpublish' : 'Publish'}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(post.id)}
                        className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
