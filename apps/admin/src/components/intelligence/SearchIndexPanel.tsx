import { useState } from "react";
import { rebuildSearchIndexApi } from "../../lib/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { RefreshCw } from "lucide-react";

interface SearchIndexPanelProps {
  indexCount: number;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function SearchIndexPanel({
  indexCount,
  onError,
  onMessage,
  onChanged,
}: SearchIndexPanelProps) {
  const [indexing, setIndexing] = useState(false);

  const handleRebuildSearch = async () => {
    setIndexing(true);
    try {
      await rebuildSearchIndexApi();
      onMessage("Search index rebuild initiated successfully.");
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Search rebuild failed");
    } finally {
      setIndexing(false);
    }
  };

  return (
    <Card className="p-6 bg-transparent border-border shadow-2xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-sm text-foreground">
            Search Index Status
          </h3>
          <p className="text-xs text-muted-foreground font-mono pt-0.5">
            Indexed Documents: {indexCount}
          </p>
        </div>
        <Button
          disabled={indexing}
          onClick={handleRebuildSearch}
          className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${indexing ? "animate-spin" : ""}`}
          />
          {indexing ? "Rebuilding Index..." : "Rebuild Search Index"}
        </Button>
      </div>
    </Card>
  );
}
