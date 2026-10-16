import { useEffect, useState } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { Database, Edit, List, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export interface ContentModelItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  fields: Array<{ key: string; name: string; type: string; required?: boolean }>;
  createdAt: string;
}

const MODEL_SETTINGS_PATH = "/admin/settings/advanced/content-models";

export function ContentModelList({
  onNavigate,
  canManage = false,
}: {
  onNavigate: (path: string) => void;
  canManage?: boolean;
}) {
  const { tr } = useAdminLocale();
  const [models, setModels] = useState<ContentModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<{ data?: ContentModelItem[]; models?: ContentModelItem[] }>(
        "/content-models",
      );
      setModels(result.data ?? result.models ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load content models");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchModels();
  }, []);

  const handleDelete = async (model: ContentModelItem) => {
    if (!window.confirm(
      "Delete model \"" + model.name + "\"? Models containing entries cannot be deleted.",
    )) return;

    try {
      await apiRequest("/content-models/" + encodeURIComponent(model.id), {
        method: "DELETE",
      });
      await fetchModels();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete content model");
    }
  };

  const filteredModels = models.filter((model) => {
    const query = search.trim().toLocaleLowerCase();
    return !query ||
      model.name.toLocaleLowerCase().includes(query) ||
      model.slug.toLocaleLowerCase().includes(query) ||
      (model.description ?? "").toLocaleLowerCase().includes(query);
  });

  const modelActions = (model: ContentModelItem) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onNavigate("/admin/collections/" + encodeURIComponent(model.slug))}
      >
        <List className="h-3.5 w-3.5" />
        {tr("Entries")}
      </Button>
      {canManage && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={tr("Edit") + " " + model.name}
            onClick={() => onNavigate(MODEL_SETTINGS_PATH + "/" + encodeURIComponent(model.id))}
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={tr("Delete") + " " + model.name}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void handleDelete(model)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );

  return (
    <section className="mx-auto w-full max-w-7xl space-y-6" aria-labelledby="content-models-title">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            {tr("Settings / Advanced")}
          </p>
          <h1 id="content-models-title" className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            <Database aria-hidden="true" className="h-5 w-5 text-primary" />
            {tr("Content Models")}
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {tr("Define reusable content structures, fields, relations, and validation rules.")}
          </p>
        </div>
        {canManage && (
          <Button type="button" size="sm"
            onClick={() => onNavigate(MODEL_SETTINGS_PATH + "/new")}
            className="self-start gap-1.5 sm:self-auto">
            <Plus className="h-4 w-4" />
            {tr("Create Model")}
          </Button>
        )}
      </header>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          <span>{error}</span>
          <Button type="button" variant="outline" size="xs" onClick={() => void fetchModels()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {tr("Retry")}
          </Button>
        </div>
      )}

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs text-muted-foreground tabular-nums">
          {loading ? tr("Loading models…") : models.length + " " + tr("content models")}
        </p>
        <div className="relative w-full sm:w-72">
          <Search aria-hidden="true" className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input type="search" aria-label={tr("Search content models")}
            placeholder={tr("Search models by name or slug")}
            value={search} onChange={(event) => setSearch(event.target.value)}
            className="h-8 bg-card ps-8 text-xs" />
        </div>
      </div>

      {loading ? (
        <Card role="status" className="space-y-3 p-5">
          <span className="text-xs text-muted-foreground">{tr("Loading content models…")}</span>
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-12 animate-pulse rounded-md bg-muted/50" />
          ))}
        </Card>
      ) : error && models.length === 0 ? null : models.length === 0 || filteredModels.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <Database aria-hidden="true" className="h-8 w-8 text-muted-foreground/50" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {models.length === 0 ? tr("No content models yet") : tr("No matching models")}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {models.length === 0
                ? tr("Create your first custom content type to structure editorial entries.")
                : tr("Try a different name, slug, or description.")}
            </p>
          </div>
          {models.length === 0 && canManage && (
            <Button type="button" size="sm" onClick={() => onNavigate(MODEL_SETTINGS_PATH + "/new")}>
              <Plus className="h-4 w-4" />
              {tr("Create Model")}
            </Button>
          )}
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden p-0 sm:block">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="ps-6">{tr("Model")}</TableHead>
                  <TableHead>{tr("API Slug")}</TableHead>
                  <TableHead>{tr("Fields")}</TableHead>
                  <TableHead className="pe-6 text-end">{tr("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModels.map((model) => (
                  <TableRow key={model.id} className="border-border hover:bg-muted/40">
                    <TableCell className="max-w-sm ps-6">
                      <div dir="auto" className="text-xs font-semibold text-foreground">{model.name}</div>
                      {model.description && (
                        <p dir="auto" className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                          {model.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <code dir="auto" className="break-all text-[11px] text-muted-foreground">{model.slug}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="tabular-nums">
                        {model.fields?.length ?? 0} {tr("fields")}
                      </Badge>
                    </TableCell>
                    <TableCell className="pe-6">{modelActions(model)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="grid gap-3 sm:hidden">
            {filteredModels.map((model) => (
              <Card key={model.id} className="space-y-3 p-4">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 dir="auto" className="break-words text-sm font-semibold text-foreground">{model.name}</h2>
                    <p dir="auto" className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {model.slug}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {model.fields?.length ?? 0} {tr("fields")}
                  </Badge>
                </div>
                {model.description && (
                  <p dir="auto" className="text-xs text-muted-foreground">{model.description}</p>
                )}
                <div className="border-t border-border/60 pt-2">{modelActions(model)}</div>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
