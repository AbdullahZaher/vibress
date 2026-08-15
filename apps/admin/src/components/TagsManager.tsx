import React, { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Input } from "./ui/input";
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

export const TagsManager: React.FC = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    if (!name.trim()) return;

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
    setEditingId(tag.id);
    setName(tag.name);
    setDescription(tag.description || "");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete tag?")) return;
    try {
      await apiRequest(`/tags/${id}`, { method: "DELETE" });
      fetchTags();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMsg(errorObj.message || "Failed to delete tag");
    }
  };

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Tags Management
        </h1>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create/Edit Form Card */}
        <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
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
                  Tag Name
                </label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Technology"
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Description (Optional)
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tag summary..."
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {editingId ? "Update Tag" : "Create Tag"}
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
                    className="h-8 text-xs"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Tags List Card */}
        <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-6 text-xs">Name</TableHead>
                <TableHead className="text-xs">Slug</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-right pr-6 text-xs">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-28 text-center text-xs text-muted-foreground"
                  >
                    Loading tags...
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

                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(tag)}
                          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <Edit className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(tag.id)}
                          className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
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
    </div>
  );
};
