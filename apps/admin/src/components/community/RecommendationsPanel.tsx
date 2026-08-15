import React, { useState } from "react";
import {
  AdminRecommendation,
  createRecommendationApi,
  archiveRecommendationApi,
} from "../../lib/api";
import { Button } from "../ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Sparkles } from "lucide-react";

interface RecommendationsPanelProps {
  recommendations: AdminRecommendation[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function RecommendationsPanel({
  recommendations,
  onError,
  onChanged,
}: RecommendationsPanelProps) {
  const [recUrl, setRecUrl] = useState("");
  const [recTitle, setRecTitle] = useState("");
  const [recDesc, setRecDesc] = useState("");

  const handleCreateRec = async (e: React.FormEvent) => {
    e.preventDefault();
    onError("");
    try {
      await createRecommendationApi({
        url: recUrl,
        title: recTitle,
        description: recDesc || null,
      });
      setRecUrl("");
      setRecTitle("");
      setRecDesc("");
      await onChanged();
    } catch (err: unknown) {
      onError(
        err instanceof Error ? err.message : "Failed to create recommendation",
      );
    }
  };

  const handleArchiveRec = async (id: string) => {
    try {
      await archiveRecommendationApi(id);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1 h-fit bg-transparent border-border shadow-2xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Add Recommendation
          </CardTitle>
          <CardDescription className="text-xs">
            Recommend another publication to your readers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateRec} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Publication URL
              </label>
              <Input
                required
                type="url"
                value={recUrl}
                onChange={(e) => setRecUrl(e.target.value)}
                placeholder="https://example.com"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Title
              </label>
              <Input
                required
                value={recTitle}
                onChange={(e) => setRecTitle(e.target.value)}
                placeholder="Publication Name"
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Description (Optional)
              </label>
              <Input
                value={recDesc}
                onChange={(e) => setRecDesc(e.target.value)}
                placeholder="Why you recommend it..."
                className="h-8 text-xs bg-card border-border"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground mt-2"
            >
              Create Recommendation
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 bg-transparent border-border shadow-2xs p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-6 text-xs">Title</TableHead>
              <TableHead className="text-xs">URL</TableHead>
              <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recommendations.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="h-32 text-center text-xs text-muted-foreground"
                >
                  No recommendations added yet.
                </TableCell>
              </TableRow>
            ) : (
              recommendations.map((rec) => (
                <TableRow
                  key={rec.id}
                  className="hover:bg-muted/40 border-border"
                >
                  <TableCell className="pl-6 font-semibold text-xs text-foreground">
                    {rec.title}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-xs">
                    {rec.url}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleArchiveRec(rec.id)}
                      className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      Archive
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
