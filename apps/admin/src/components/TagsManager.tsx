import { useAdminLocale } from "../lib/admin-locale";
import React, { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { AdminPageHeader } from "./common/AdminPageHeader";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Input } from "./ui/input";
import { Dialog } from "./ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import { Tag as TagIcon, Edit, Trash2, Hash } from "lucide-react";

interface Tag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface TagsManagerProps {
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

export const TagsManager: React.FC<TagsManagerProps> = ({
  canCreate = false,
  canEdit = false,
  canDelete = false,
}) => {
  const { tr } = useAdminLocale();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTags = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ tags: Tag[] }>("/tags");
      setTags(res.tags || []);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMsg(errorObj.message || "Failed to load tags");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim() || (editingId ? !canEdit : !canCreate)) return;

    try {
      if (editingId) {
        await apiRequest(`/tags/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({ name, description: description || null }),
        });
      } else {
        await apiRequest("/tags", {
          method: "POST",
          body: JSON.stringify({ name, description: description || null }),
        });
      }
      setName("");
      setDescription("");
      setEditingId(null);
      fetchTags();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMsg(errorObj.message || "Failed to save tag");
    }
  };

  const handleEdit = (tag: Tag) => {
    if (!canEdit) return;
    setEditingId(tag.id);
    setName(tag.name);
    setDescription(tag.description || "");
  };

  const handleDelete = (id: string) => {
    if (canDelete) setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!canDelete || !deleteConfirmId || deleting) return;
    setDeleting(true);
    try {
      await apiRequest(`/tags/${deleteConfirmId}`, { method: "DELETE" });
      setDeleteConfirmId(null);
      await fetchTags();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMsg(errorObj.message || "Failed to delete tag");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <AdminPageHeader
        title={tr("Tags Management")}
        description={tr("Organize and classify posts and editorial content with taxonomies.")}
      />

      {errorMsg && (
        <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className={`grid grid-cols-1 gap-6 ${canCreate || (canEdit && Boolean(editingId)) ? "lg:grid-cols-3" : "lg:grid-cols-1"}`}>
        {/* Create/Edit Form Card */}
        {(canCreate || (canEdit && editingId)) && <Card className="lg:col-span-1 h-fit border-border/70 shadow-2xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <TagIcon className="h-4 w-4 text-primary" />
              {editingId ? "Edit Tag" : "New Tag"}
            </CardTitle>
            <CardDescription className="text-xs">
              {editingId
                ? "Update existing tag metadata."
                : "Create a tag to organize posts."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  {tr("Tag Name")}
                </label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tr("e.g. Technology")}
                  className="h-11 text-sm bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  {tr("Description (Optional)")}
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={tr("Tag summary...")}
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="submit"
                  size="sm"
                  className="min-h-11 text-sm font-semibold"
                >
                  {editingId ? tr("Update Tag") : tr("Create Tag")}
                </Button>
                {editingId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(null);
                      setName("");
                      setDescription("");
                    }}
                    className="min-h-11 text-sm"
                  >
                    {tr("Cancel")}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>}

        {/* Tags List Card */}
        <Card className="lg:col-span-2 border-border/70 shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">{tr("Name")}</TableHead>
                <TableHead className="text-xs">{tr("Slug")}</TableHead>
                <TableHead className="text-xs">{tr("Description")}</TableHead>
                {(canEdit || canDelete) && <TableHead className="text-end pe-6 text-xs">
                  {tr("Actions")}
                </TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={canEdit || canDelete ? 4 : 3}
                    className="h-28 text-center text-xs text-muted-foreground"
                  >
                    {tr("Loading tags...")}
                  </TableCell>
                </TableRow>
              ) : tags.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-28 text-center text-xs text-muted-foreground"
                  >
                    No tags created yet.
                  </TableCell>
                </TableRow>
              ) : (
                tags.map((tag) => (
                  <TableRow
                    key={tag.id}
                    className="hover:bg-muted/40 border-border"
                  >
                    <TableCell className="pl-6 font-semibold text-xs text-foreground flex items-center gap-2">
                      <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                      {tag.name}
                    </TableCell>

                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {tag.slug}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {tag.description || "—"}
                    </TableCell>

                    {(canEdit || canDelete) && (
                      <TableCell className="text-end pe-6">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && (
                            <IconButton
                              label={tr("Edit")}
                              accessibleLabel={`${tr("Edit")}: ${tag.name}`}
                              onClick={() => handleEdit(tag)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Edit className="size-4" aria-hidden="true" />
                            </IconButton>
                          )}
                          {canDelete && (
                            <IconButton
                              label={tr("Delete")}
                              accessibleLabel={`${tr("Delete")}: ${tag.name}`}
                              onClick={() => handleDelete(tag.id)}
                              className="text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </IconButton>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog
        isOpen={!!deleteConfirmId}
        onClose={() => { if (!deleting) setDeleteConfirmId(null); }}
        title={tr("Delete tag?")}
        description={tr("This tag will be removed. Existing content will not be deleted.")}
        className="max-w-md"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteConfirmId(null)}>{tr("Cancel")}</Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
            {deleting ? tr("Processing...") : tr("Confirm delete")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
