import React, { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import {
  Plus,
  Search,
  FileText,
  Edit,
  Trash2,
  Globe,
  EyeOff,
  Calendar,
  AlertCircle,
  RefreshCw,
  Clock,
  User,
} from "lucide-react";

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

export const PostsList: React.FC<PostsListProps> = ({
  onNavigate,
  canPublish,
  filterStatus,
}) => {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(filterStatus || "all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPosts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ posts: PostSummary[] }>("/posts");
      setPosts(data.posts || []);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setError(errorObj.message || "Failed to fetch posts");
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
      const endpoint =
        post.status === "published"
          ? `/posts/${post.id}/unpublish`
          : `/posts/${post.id}/publish`;
      await apiRequest(endpoint, { method: "POST" });
      fetchPosts();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || "Action failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this post?")) return;
    try {
      await apiRequest(`/posts/${id}`, { method: "DELETE" });
      fetchPosts();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || "Delete failed");
    }
  };

  const filteredPosts = posts.filter((post) => {
    const matchesStatus =
      statusFilter === "all" || post.status === statusFilter;
    const matchesSearch =
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.slug.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return (
          <Badge variant="published" className="text-[11px] font-mono">
            <Globe className="h-3 w-3" />
            <span>Published</span>
          </Badge>
        );
      case "scheduled":
        return (
          <Badge variant="scheduled" className="text-[11px] font-mono">
            <Calendar className="h-3 w-3" />
            <span>Scheduled</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="draft" className="text-[11px] font-mono">
            <EyeOff className="h-3 w-3" />
            <span>Draft</span>
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 w-full max-w-7xl mx-auto animate-pulse">
        <div className="flex justify-between items-center">
          <div className="h-7 w-24 bg-muted rounded-md" />
          <div className="h-9 w-28 bg-muted rounded-md" />
        </div>
        <div className="flex justify-between items-center gap-4">
          <div className="h-8 w-64 bg-muted rounded-md" />
          <div className="h-8 w-48 bg-muted rounded-md" />
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 w-full bg-muted/40 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-6 rounded-xl bg-card border border-rose-500/20 text-foreground space-y-3">
        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>Unable to load publication posts</span>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchPosts} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Try again</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Posts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage editorial articles, revisions, and publication schedules.
          </p>
        </div>
        <Button
          onClick={() => onNavigate("/admin/posts/new")}
          className="h-9 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs cursor-pointer self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" /> Create Post
        </Button>
      </div>

      {/* Filter Tabs Bar & Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "all"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All <span className="ms-1 text-[11px] opacity-70 tabular-nums">({posts.length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("published")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "published"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Published <span className="ms-1 text-[11px] opacity-70 tabular-nums">({posts.filter((p) => p.status === "published").length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("draft")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "draft"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Drafts <span className="ms-1 text-[11px] opacity-70 tabular-nums">({posts.filter((p) => p.status === "draft").length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("scheduled")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "scheduled"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Scheduled <span className="ms-1 text-[11px] opacity-70 tabular-nums">({posts.filter((p) => p.status === "scheduled").length})</span>
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Filter posts by title or slug..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-8 h-8 text-xs bg-card border-border/70"
          />
        </div>
      </div>

      {/* 1. Desktop & Tablet Table View */}
      <div className="hidden sm:block rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-6">Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-end pe-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPosts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-40 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center justify-center space-y-2 py-4">
                    <FileText className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-xs font-medium text-foreground">
                      No posts found
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {searchQuery
                        ? "Try adjusting your search query or clear the filter."
                        : "Start creating your first editorial article."}
                    </p>
                    {!searchQuery && (
                      <Button
                        size="sm"
                        onClick={() => onNavigate("/admin/posts/new")}
                        className="mt-2 text-xs gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" /> New Post
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredPosts.map((post) => (
                <TableRow
                  key={post.id}
                  className="hover:bg-muted/40 transition-colors"
                >
                  <TableCell className="ps-6 font-medium">
                    <div className="flex flex-col text-start">
                      <button
                        onClick={() => onNavigate(`/admin/posts/${post.id}`)}
                        className="text-start font-semibold text-foreground hover:text-primary transition-colors cursor-pointer text-xs sm:text-sm"
                      >
                        {post.title}
                      </button>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        /{post.slug}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>{getStatusBadge(post.status)}</TableCell>

                  <TableCell className="text-xs text-muted-foreground font-medium">
                    {post.authors?.[0]?.name || "Admin"}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                    {new Date(post.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>

                  <TableCell className="text-end pe-6">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onNavigate(`/admin/posts/${post.id}`)}
                        className="gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <Edit className="h-3.5 w-3.5" /> Edit
                      </Button>

                      {canPublish && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => handlePublishToggle(post)}
                          className="cursor-pointer"
                        >
                          {post.status === "published"
                            ? "Unpublish"
                            : "Publish"}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(post.id)}
                        className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        title="Delete post"
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
      </div>

      {/* 2. Mobile Responsive Stacked Card View (<640px) */}
      <div className="sm:hidden space-y-3">
        {filteredPosts.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-card p-6 text-center text-muted-foreground space-y-2">
            <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <p className="text-xs font-medium text-foreground">No posts found</p>
            <p className="text-[11px] text-muted-foreground">
              {searchQuery
                ? "Try adjusting your search query."
                : "Start creating your first article."}
            </p>
          </div>
        ) : (
          filteredPosts.map((post) => (
            <div
              key={post.id}
              className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0 text-start">
                  <button
                    onClick={() => onNavigate(`/admin/posts/${post.id}`)}
                    className="font-semibold text-xs text-foreground hover:text-primary transition-colors cursor-pointer text-start line-clamp-2"
                  >
                    {post.title}
                  </button>
                  <span className="text-[11px] text-muted-foreground font-mono block truncate">
                    /{post.slug}
                  </span>
                </div>
                <div className="shrink-0">{getStatusBadge(post.status)}</div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                <span className="flex items-center gap-1 font-medium">
                  <User className="h-3 w-3" />
                  {post.authors?.[0]?.name || "Admin"}
                </span>
                <span className="font-mono tabular-nums flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(post.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>

              <div className="flex items-center justify-end gap-1.5 pt-1">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onNavigate(`/admin/posts/${post.id}`)}
                  className="gap-1 text-xs"
                >
                  <Edit className="h-3 w-3" /> Edit
                </Button>
                {canPublish && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handlePublishToggle(post)}
                    className="text-xs"
                  >
                    {post.status === "published" ? "Unpublish" : "Publish"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(post.id)}
                  className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
