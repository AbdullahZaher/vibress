import React, { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
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
} from "lucide-react";

interface PageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "published" | "draft"
  >("all");

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
    if (!confirm("Delete page?")) return;
    try {
      await apiRequest(`/pages/${id}`, { method: "DELETE" });
      fetchPages();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      alert(errorObj.message || "Delete failed");
    }
  };

  const filteredPages = pages.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Loading site pages...</span>
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
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Static Pages
        </h1>
        <Button
          onClick={() => onNavigate("/admin/pages/new")}
          className="h-9 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Create Page
        </Button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === "all"
                ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({pages.length})
          </button>
          <button
            onClick={() => setStatusFilter("published")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === "published"
                ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Published ({pages.filter((p) => p.status === "published").length})
          </button>
          <button
            onClick={() => setStatusFilter("draft")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              statusFilter === "draft"
                ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Drafts ({pages.filter((p) => p.status === "draft").length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search pages by title..."
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
              <TableHead className="text-xs">Updated</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPages.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-36 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <FileCode className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-xs font-medium">
                      No pages found matching filter.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredPages.map((page) => (
                <TableRow
                  key={page.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-medium">
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-foreground">
                        {page.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        /{page.slug}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    {page.status === "published" ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      >
                        Published
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                      >
                        Draft
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {new Date(page.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>

                  <TableCell className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1.5">
                      {canPublish && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePublishToggle(page)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                          title={
                            page.status === "published"
                              ? "Unpublish"
                              : "Publish"
                          }
                        >
                          {page.status === "published" ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Globe className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onNavigate(`/admin/pages/${page.id}`)}
                        className="h-7 px-2.5 text-xs border-border bg-card hover:bg-accent text-foreground cursor-pointer"
                      >
                        <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(page.id)}
                        className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
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
      </Card>
    </div>
  );
};
