import React, { useState, useEffect } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Share2, Plus, X, RefreshCw, Trash2, Globe } from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  listRecommendationsApi,
  createRecommendationApi,
  archiveRecommendationApi,
  AdminRecommendation,
} from "../../../lib/api/recommendations";

interface RecommendationsCardProps {
  isHighlighted?: boolean | undefined;
}

export const RecommendationsCard: React.FC<RecommendationsCardProps> = ({
  isHighlighted,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [items, setItems] = useState<AdminRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await listRecommendationsApi();
      setItems(res.recommendations || []);
    } catch {
      // Keep state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpen = () => {
    setIsModalOpen(true);
    loadData();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !url) return;
    setSaving(true);
    setError(null);
    try {
      await createRecommendationApi({
        title: title.trim(),
        url: url.trim(),
        description: desc.trim() || null,
      });
      setIsCreating(false);
      setTitle("");
      setUrl("");
      setDesc("");
      loadData();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to add recommendation",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveRecommendationApi(id);
      loadData();
    } catch {
      // Keep state
    }
  };

  const activeCount = items.filter((i) => i.status === "active").length;

  return (
    <>
      <SettingsCard id="growth-recommendations" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Share2 className="h-4 w-4" />}
          title="Recommendations & blogroll"
          description="Recommend other independent publications to your readers to exchange audience growth."
          currentValue={
            <Badge
              variant="outline"
              className="text-xs font-mono text-muted-foreground"
            >
              {activeCount}{" "}
              {activeCount === 1 ? "Recommendation" : "Recommendations"}
            </Badge>
          }
          actionLabel="Manage"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Recommendations Modal */}
      <SettingsModalPortal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Publication Recommendations
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-xs">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading
                  recommendations...
                </div>
              ) : items.length === 0 && !isCreating ? (
                <div className="p-8 rounded-xl border border-dashed border-border/70 text-center space-y-2 bg-muted/10">
                  <Globe className="h-7 w-7 text-muted-foreground mx-auto opacity-50" />
                  <p className="text-xs font-semibold text-foreground">
                    No recommendations yet
                  </p>
                  <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                    Recommend newsletters and blogs to your subscribers to
                    cross-promote with fellow creators.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-56 overflow-y-auto">
                  {items.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-3 rounded-xl border border-border/60 bg-muted/10 flex items-center justify-between"
                    >
                      <div>
                        <h5 className="text-xs font-bold text-foreground">
                          {rec.title}
                        </h5>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {rec.url}
                        </p>
                        {rec.description && (
                          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                            {rec.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleArchive(rec.id)}
                        className="text-muted-foreground hover:text-destructive p-1 rounded-md cursor-pointer"
                        title="Remove recommendation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Create Recommendation Form */}
              {isCreating ? (
                <form
                  onSubmit={handleCreate}
                  className="p-4 rounded-xl border border-primary/40 bg-primary/5 space-y-3 animate-in fade-in duration-150"
                >
                  <h4 className="text-xs font-bold text-foreground">
                    Recommend a Publication
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      placeholder="Publication Title (e.g. Tech Weekly)"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="text-xs h-8.5 bg-card"
                      required
                    />
                    <Input
                      type="url"
                      placeholder="Website URL (e.g. https://tech.io)"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="text-xs h-8.5 bg-card font-mono"
                      required
                    />
                  </div>
                  <Input
                    placeholder="Short endorsement (optional)"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    className="text-xs h-8.5 bg-card"
                  />
                  {error && (
                    <p className="text-xs text-destructive font-medium">
                      {error}
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsCreating(false)}
                      className="text-xs h-8 cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={saving}
                      className="text-xs h-8 cursor-pointer"
                    >
                      {saving ? "Adding..." : "Add Recommendation"}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex justify-end pt-2 border-t border-border/40">
                  <Button
                    size="sm"
                    onClick={() => setIsCreating(true)}
                    className="gap-1.5 text-xs cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Recommendation
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
