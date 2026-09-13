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
  FileCode,
  Edit,
  Trash2,
  Globe,
  EyeOff,
  AlertCircle,
  RefreshCw,
  Clock,
} from "lucide-react";

interface PageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
}

interface PagesListProps {
  onNavigate: (path: string) => void;
  canPublish: boolean;
}

export const PagesList: React.FC<PagesListProps> = ({
  onNavigate,
  canPublish,
}) => {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPages = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ pages: PageSummary[] }>("/pages");
      setPages(data.pages || []);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setError(errorObj.message || "Failed to fetch pages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPages();
  }, []);

  const handlePublishToggle = async (page: PageSummary) => {
    if (!canPublish) return;
    try {
      const endpoint =
        page.status === "published"
          ? `/pages/${page.id}/unpublish`
          : `/pages/${page.id}/publish`;
      await apiRequest(endpoint, { method: "POST" });
      fetchPages();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || "Action failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this page?")) return;
    try {
      await apiRequest(`/pages/${id}`, { method: "DELETE" });
      fetchPages();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || "Delete failed");
    }
  };

  const filteredPages = pages.filter((page) => {
    const matchesStatus =
      statusFilter === "all" || page.status === statusFilter;
    const matchesSearch =
      page.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      page.slug.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  if (loading) {
    return (
      <div className="space-y-6 w-full max-w-7xl mx-auto animate-pulse">
        <div className="flex justify-between items-center">
          <div className="h-7 w-32 bg-muted rounded-md" />
          <div className="h-9 w-28 bg-muted rounded-md" />
        </div>
        <div className="flex justify-between items-center gap-4">
          <div className="h-8 w-56 bg-muted rounded-md" />
          <div className="h-8 w-48 bg-muted rounded-md" />
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
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
          <span>Unable to load static pages</span>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchPages} className="gap-1.5">
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
            Static Pages
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage standalone site pages, legal policies, and landing documents.
          </p>
        </div>
        <Button
          onClick={() => onNavigate("/admin/pages/new")}
          className="h-9 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs cursor-pointer self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" /> Create Page
        </Button>
      </div>

      {/* Filter Tabs & Search Bar */}
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
            All <span className="ms-1 text-[11px] opacity-70 tabular-nums">({pages.length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("published")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "published"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Published <span className="ms-1 text-[11px] opacity-70 tabular-nums">({pages.filter((p) => p.status === "published").length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("draft")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "draft"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Drafts <span className="ms-1 text-[11px] opacity-70 tabular-nums">({pages.filter((p) => p.status === "draft").length})</span>
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search pages by title or slug..."
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
              <TableHead>Updated</TableHead>
              <TableHead className="text-end pe-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPages.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-40 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center justify-center space-y-2 py-4">
                    <FileCode className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-xs font-medium text-foreground">
                      No pages found
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {searchQuery
                        ? "Try adjusting your search criteria."
                        : "Start creating your first static page."}
                    </p>
                    {!searchQuery && (
                      <Button
                        size="sm"
                        onClick={() => onNavigate("/admin/pages/new")}
                        className="mt-2 text-xs gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" /> New Page
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredPages.map((page) => (
                <TableRow
                  key={page.id}
                  className="hover:bg-muted/40 transition-colors"
                >
                  <TableCell className="ps-6 font-medium">
                    <div className="flex flex-col text-start">
                      <button
                        onClick={() => onNavigate(`/admin/pages/${page.id}`)}
                        className="text-start font-semibold text-xs sm:text-sm text-foreground hover:text-primary transition-colors cursor-pointer"
                      >
                        {page.title}
                      </button>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        /{page.slug}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    {page.status === "published" ? (
                      <Badge variant="published" className="text-[11px] font-mono">
                        <Globe className="h-3 w-3" />
                        <span>Published</span>
                      </Badge>
                    ) : (
                      <Badge variant="draft" className="text-[11px] font-mono">
                        <EyeOff className="h-3 w-3" />
                        <span>Draft</span>
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                    {new Date(page.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>

                  <TableCell className="text-end pe-6">
                    <div className="flex items-center justify-end gap-1.5">
                      {canPublish && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handlePublishToggle(page)}
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                          title={
                            page.status === "published"
                              ? "Unpublish"
                              : "Publish"
                          }
                        >
                          {page.status === "published" ? (
                            <span className="flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" /> Unpublish</span>
                          ) : (
                            <span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> Publish</span>
                          )}
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onNavigate(`/admin/pages/${page.id}`)}
                        className="cursor-pointer gap-1"
                      >
                        <Edit className="h-3.5 w-3.5" /> Edit
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(page.id)}
                        className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        title="Delete page"
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
        {filteredPages.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-card p-6 text-center text-muted-foreground space-y-2">
            <FileCode className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <p className="text-xs font-medium text-foreground">No pages found</p>
            <p className="text-[11px] text-muted-foreground">
              {searchQuery
                ? "Try adjusting your search query."
                : "Start creating your first page."}
            </p>
          </div>
        ) : (
          filteredPages.map((page) => (
            <div
              key={page.id}
              className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0 text-start">
                  <button
                    onClick={() => onNavigate(`/admin/pages/${page.id}`)}
                    className="font-semibold text-xs text-foreground hover:text-primary transition-colors cursor-pointer text-start line-clamp-2"
                  >
                    {page.title}
                  </button>
                  <span className="text-[11px] text-muted-foreground font-mono block truncate">
                    /{page.slug}
                  </span>
                </div>
                <div className="shrink-0">
                  {page.status === "published" ? (
                    <Badge variant="published" className="text-[11px] font-mono">
                      Published
                    </Badge>
                  ) : (
                    <Badge variant="draft" className="text-[11px] font-mono">
                      Draft
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                <span className="font-mono tabular-nums flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(page.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onNavigate(`/admin/pages/${page.id}`)}
                    className="gap-1 text-xs"
                  >
                    <Edit className="h-3 w-3" /> Edit
                  </Button>
                  {canPublish && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handlePublishToggle(page)}
                      className="text-xs"
                    >
                      {page.status === "published" ? "Unpublish" : "Publish"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(page.id)}
                    className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
