import { useState, useEffect, useMemo } from "react";
import { Plus, Edit, Trash2, ArrowLeft, Layers, Search, RefreshCw, Calendar } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Dialog } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { Alert, AlertDescription } from "../ui/alert";

export interface CollectionEntryItem {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
}

export function DynamicCollectionList({
  modelSlug,
  onNavigate,
}: {
  modelSlug: string;
  onNavigate: (path: string) => void;
}) {
  const [entries, setEntries] = useState<CollectionEntryItem[]>([]);
  const [modelName, setModelName] = useState(modelSlug);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "archived">("all");
  const [deleteTarget, setDeleteTarget] = useState<CollectionEntryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchEntries = async () => {
    try {
      setLoading(true);
      setError(null);
      const modelRes = await apiRequest<{
        data?: { name: string };
        model?: { name: string };
      }>(`/content-models/${modelSlug}`).catch(() => ({ data: undefined, model: { name: modelSlug } }));
      setModelName(modelRes.data?.name || modelRes.model?.name || modelSlug);

      // Fetch collection entries
      const entriesRes = await apiRequest<{
        data?: CollectionEntryItem[];
        entries?: CollectionEntryItem[];
      }>(`/content-models/${modelSlug}/entries`);
      setEntries(entriesRes.data || entriesRes.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEntries();
  }, [modelSlug]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        entry.title.toLowerCase().includes(q) ||
        entry.slug.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [entries, statusFilter, searchQuery]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await apiRequest(`/api/admin/v1/content-models/${modelSlug}/entries/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setDeleteTarget(null);
      await fetchEntries();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete entry");
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published":
        return (
          <Badge variant="published" className="text-[11px] font-mono capitalize">
            Published
          </Badge>
        );
      case "archived":
        return (
          <Badge variant="secondary" className="text-[11px] font-mono capitalize">
            Archived
          </Badge>
        );
      default:
        return (
          <Badge variant="draft" className="text-[11px] font-mono capitalize">
            Draft
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("/admin/models")}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
            title="Back to Content Models"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            <span className="hidden sm:inline">Back to Models</span>
          </Button>

          <div className="h-4 w-[1px] bg-border hidden sm:block" />

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {modelName}
              </h1>
              <Badge variant="secondary" className="text-[10px] font-mono">
                /api/content/v1/collections/{modelSlug}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Structured entry records belonging to the {modelName} collection.
            </p>
          </div>
        </div>

        <Button
          onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
          className="gap-2 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          New Entry
        </Button>
      </div>

      {/* Global Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button variant="outline" size="xs" onClick={fetchEntries} className="gap-1 shrink-0">
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Filter / Search Toolbar */}
      {entries.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {(["all", "published", "draft", "archived"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all cursor-pointer whitespace-nowrap ${
                  statusFilter === tab
                    ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "all" ? "All Entries" : tab}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ps-9 h-8 text-xs bg-card border-border/70"
            />
          </div>
        </div>
      )}

      {/* Content Area */}
      {loading ? (
        <Card className="p-0 overflow-hidden shadow-2xs">
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 w-full bg-muted/40 rounded-lg animate-pulse" />
            ))}
          </div>
        </Card>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-6 w-6 text-primary" />}
          title="No Entries Yet"
          description="Create your first entry in this structured content collection."
          action={
            <Button
              onClick={() => onNavigate(`/admin/collections/${modelSlug}/new`)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Entry
            </Button>
          }
        />
      ) : filteredEntries.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-dashed border-border/70 bg-muted/10 p-6">
          <p className="text-sm font-medium text-foreground">No entries match your filter</p>
          <p className="text-xs text-muted-foreground mt-1">Try resetting search or status filters.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="mt-3 text-xs"
          >
            Reset Filters
          </Button>
        </div>
      ) : (
        <>
          {/* 1. Desktop & Tablet Table View */}
          <div className="hidden sm:block rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-5">Title</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-end pe-5">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.id} className="cursor-pointer">
                    <TableCell
                      className="ps-5 font-medium text-foreground hover:text-primary"
                      onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                    >
                      {entry.title}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground"
                      onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                    >
                      {entry.slug}
                    </TableCell>
                    <TableCell onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}>
                      {getStatusBadge(entry.status)}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-muted-foreground/60" />
                        <span>{new Date(entry.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-end pe-5">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit Entry"
                          aria-label={`Edit ${entry.title}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteTarget(entry)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete Entry"
                          aria-label={`Delete ${entry.title}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 2. Mobile Responsive Stacked Card View (<640px) */}
          <div className="sm:hidden space-y-3">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 text-start">
                    <button
                      type="button"
                      onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                      className="font-semibold text-xs text-foreground hover:text-primary transition-colors cursor-pointer text-start line-clamp-2"
                    >
                      {entry.title}
                    </button>
                    <span className="text-[11px] text-muted-foreground font-mono block truncate">
                      /{entry.slug}
                    </span>
                  </div>
                  <div className="shrink-0">{getStatusBadge(entry.status)}</div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/40">
                  <div className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-muted-foreground/60" />
                    <span>{new Date(entry.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="inline-flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onNavigate(`/admin/collections/${modelSlug}/${entry.id}`)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Edit Entry"
                      aria-label={`Edit ${entry.title}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(entry)}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete Entry"
                      aria-label={`Delete ${entry.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Accessible Confirmation Modal Dialog */}
      <Dialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => {
          if (!isDeleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title="Delete Collection Entry"
        description={`Are you sure you want to delete "${deleteTarget?.title}"? This entry will be permanently removed from ${modelName}.`}
      >
        <div className="space-y-4">
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}

          <p className="text-xs text-muted-foreground leading-relaxed">
            This action cannot be undone. Any references to this entry across other models will no longer resolve.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmDelete}
              loading={isDeleting}
            >
              Delete Entry
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
