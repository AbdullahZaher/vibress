import React from "react";
import { Search, X } from "lucide-react";
import { useAdminLocale } from "../../lib/admin-locale";

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
  const { tr } = useAdminLocale();
  return (
    <div className="relative w-full shrink-0 lg:w-64">
      <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={tr("Filter settings...")}
        aria-label={tr("Filter settings...")}
        className="min-h-11 w-full rounded-lg border border-input bg-background ps-10 pe-11 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="absolute end-1 top-1/2 -translate-y-1/2 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={tr("Clear search")}
          aria-label={tr("Clear search")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        resultCount !== undefined &&
        totalCount !== undefined && (
          <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground pointer-events-none">
            {resultCount}/{totalCount}
          </span>
        )
      )}
    </div>
  );
};
