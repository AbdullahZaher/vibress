import React from "react";
import { Search, X } from "lucide-react";

export interface SettingsSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  resultCount?: number | undefined;
  totalCount?: number | undefined;
}

export const SettingsSearch: React.FC<SettingsSearchProps> = ({
  query,
  onQueryChange,
  resultCount,
  totalCount,
}) => {
  return (
    <div className="relative w-full md:w-72 shrink-0">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter settings (e.g. GA, SMTP, Stripe)..."
        aria-label="Search and filter settings"
        className="w-full h-8.5 pl-8 pr-8 text-xs bg-muted/40 border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-all"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer transition-colors"
          title="Clear search"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        resultCount !== undefined &&
        totalCount !== undefined && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground pointer-events-none">
            {resultCount}/{totalCount}
          </span>
        )
      )}
    </div>
  );
};
