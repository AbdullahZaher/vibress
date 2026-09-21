import { useState, useEffect, useMemo } from "react";
import { Plus, Database, Edit, Trash2, List, Search, Layers, RefreshCw } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../ui/card";
import { Input } from "../ui/input";
import { Dialog } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { Alert, AlertDescription } from "../ui/alert";

export interface ContentModelItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  fields: Array<{ key: string; name: string; type: string; required?: boolean }>;
  createdAt: string;
}

export function ContentModelList({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [models, setModels] = useState<ContentModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ContentModelItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{ data?: ContentModelItem[]; models?: ContentModelItem[] }>(
        "/content-models",
      );
      setModels(res.data || res.models || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load content models");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchModels();
  }, []);

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const q = searchQuery.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q)),
    );
  }, [models, searchQuery]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await apiRequest(`/api/admin/v1/content-models/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await fetchModels();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete content model");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
              <Database className="h-4 w-4" />
            </div>
            Content Modeler
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Design custom structured content models, validation schemas, and collection APIs.
          </p>
        </div>
        <Button
          onClick={() => onNavigate("/admin/models/new")}
          className="gap-2 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Create Model
        </Button>
      </div>

      {/* Global Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button variant="outline" size="xs" onClick={fetchModels} className="gap-1 shrink-0">
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Filter / Search Bar */}
      {models.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search models by name or slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ps-9 h-9 text-xs sm:text-sm bg-card border-border/70"
            />
          </div>
          <span className="text-xs text-muted-foreground font-medium self-end sm:self-center">
            Showing {filteredModels.length} of {models.length} {models.length === 1 ? "model" : "models"}
          </span>
        </div>
      )}

      {/* Content Area */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border/70 bg-card p-5 space-y-4 animate-pulse shadow-2xs"
            >
              <div className="flex items-center justify-between">
                <div className="h-5 w-36 bg-muted rounded-md" />
                <div className="h-4 w-20 bg-muted rounded-md" />
              </div>
              <div className="space-y-2">
                <div className="h-3.5 w-full bg-muted/60 rounded-md" />
                <div className="h-3.5 w-3/4 bg-muted/60 rounded-md" />
              </div>
              <div className="pt-4 border-t border-border/50 flex justify-between items-center">
                <div className="h-7 w-24 bg-muted rounded-md" />
                <div className="h-7 w-16 bg-muted rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <EmptyState
          icon={<Database className="h-6 w-6 text-primary" />}
          title="No Content Models Found"
          description="Get started by creating your first structured content type for products, portfolios, courses, or events."
          action={
            <Button
              onClick={() => onNavigate("/admin/models/new")}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Create First Model
            </Button>
          }
        />
      ) : filteredModels.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-dashed border-border/70 bg-muted/10 p-6">
          <p className="text-sm font-medium text-foreground">No models matching "{searchQuery}"</p>
          <p className="text-xs text-muted-foreground mt-1">Try searching with a different name or slug.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSearchQuery("")}
            className="mt-3 text-xs"
          >
            Clear Search
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModels.map((model) => (
            <Card
              key={model.id}
              className="flex flex-col justify-between shadow-2xs hover:shadow-xs hover:border-border transition-all duration-150"
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold leading-snug tracking-tight text-foreground">
                    {model.name}
                  </CardTitle>
                  <Badge variant="secondary" className="font-mono text-[11px] shrink-0">
                    {model.slug}
                  </Badge>
                </div>
                {model.description && (
                  <CardDescription className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                    {model.description}
                  </CardDescription>
                )}
              </CardHeader>

              <CardContent className="p-5 pt-0 pb-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground/70" />
                  <span className="font-medium">
                    {model.fields?.length || 0} {model.fields?.length === 1 ? "field" : "fields"} configured
                  </span>
                </div>
              </CardContent>

              <CardFooter className="p-4 pt-3 border-t border-border/60 flex items-center justify-between bg-muted/10">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate(`/admin/collections/${model.slug}`)}
                  className="gap-1.5 text-xs text-foreground hover:text-primary font-medium"
                >
                  <List className="h-3.5 w-3.5" />
                  View Entries
                </Button>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onNavigate(`/admin/models/${model.id}`)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Edit Model Schema"
                    aria-label={`Edit ${model.name} schema`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(model)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Delete Model"
                    aria-label={`Delete ${model.name} model`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
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
        title="Delete Content Model"
        description={`Are you sure you want to delete model "${deleteTarget?.name}"? All entries and schema definitions in this collection will be permanently deleted.`}
      >
        <div className="space-y-4">
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}

          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
            <strong>Warning:</strong> This operation is irreversible. Any API endpoints relying on{" "}
            <code className="font-mono font-semibold">/api/content/v1/collections/{deleteTarget?.slug}</code> will
            cease responding.
          </div>

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
              Delete Model
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
