import { useAdminLocale } from "../lib/admin-locale";
import React, { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { AdminPageHeader } from "./common/AdminPageHeader";
import { Button } from "./ui/button";
import { EditorialListRow } from "./common/EditorialListRow";
import { Input } from "./ui/input";
import { Plus, Search, FileCode, AlertCircle, RefreshCw } from "lucide-react";

interface PageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
  authors?: Array<{ name: string; email: string }>;
}

interface PagesListProps {
  onNavigate: (path: string) => void;
  canPublish: boolean;
}

export const PagesList: React.FC<PagesListProps> = ({
  onNavigate,
  canPublish,
}) => {
  const { tr } = useAdminLocale();
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
          <span>{tr("Unable to load static pages")}</span>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchPages} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{tr("Try again")}</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <AdminPageHeader
        title={tr("Static Pages")}
        description={tr("Manage standalone site pages, legal policies, and landing documents.")}
        actions={
          <Button
            onClick={() => onNavigate("/admin/pages/new")}
            className="h-9 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" /> {tr("Create Page")}
          </Button>
        }
      />

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
            {tr("All")} <span className="ms-1 text-[11px] opacity-70 tabular-nums">({pages.length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("published")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "published"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tr("Published")} <span className="ms-1 text-[11px] opacity-70 tabular-nums">({pages.filter((p) => p.status === "published").length})</span>
          </button>
          <button
            onClick={() => setStatusFilter("draft")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === "draft"
                ? "bg-card text-foreground border border-border/80 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tr("Drafts")} <span className="ms-1 text-[11px] opacity-70 tabular-nums">({pages.filter((p) => p.status === "draft").length})</span>
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder={tr("Search pages by title or slug...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-8 h-8 text-xs bg-card border-border/70"
          />
        </div>
      </div>

      {/* Responsive editorial rows: one layout across desktop, tablet and mobile. */}
      <div role="list" aria-label={tr("Pages")} className="divide-y divide-border/70">
        {filteredPages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <FileCode className="size-9 opacity-40" aria-hidden="true" />
            <p className="font-medium text-foreground">{tr("No pages found")}</p>
            <p className="text-sm">{tr("Try a different search or filter.")}</p>
            {!searchQuery && statusFilter === "all" && (
              <Button size="sm" onClick={() => onNavigate("/admin/pages/new")}>
                <Plus className="size-4" aria-hidden="true" />
                {tr("Create Page")}
              </Button>
            )}
          </div>
        ) : (
          filteredPages.map((page) => (
            <EditorialListRow
              key={page.id}
              title={page.title}
              authorName={page.authors?.[0]?.name}
              date={page.status === "published" && page.publishedAt ? page.publishedAt : page.updatedAt}
              status={page.status}
              
              onEdit={() => onNavigate(`/admin/pages/${page.id}`)}
              onPublishToggle={canPublish ? () => handlePublishToggle(page) : undefined}
              onDelete={() => handleDelete(page.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};
