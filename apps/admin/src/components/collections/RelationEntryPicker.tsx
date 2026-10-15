import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api/client";

interface RelationOption {
  id: string;
  title: string;
  slug: string;
}

const PAGE_SIZE = 25;

export function relationKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (typeof item.id === "string") return item.id;
    if (typeof item.slug === "string") return item.slug;
  }
  return "";
}

export function relationKeys(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(relationKey).filter((key) => key.length > 0)
    : [];
}

/** Search and paginate publication-scoped entries without dropping off-page selections. */
export function RelationEntryPicker({
  fieldName,
  targetModel,
  multiple,
  value,
  onChange,
  required = false,
  maxItems = 100,
}: {
  fieldName: string;
  targetModel?: string;
  multiple: boolean;
  value: unknown;
  onChange: (value: string | string[]) => void;
  required?: boolean;
  maxItems?: number;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState<RelationOption[]>([]);
  const [known, setKnown] = useState<Record<string, RelationOption>>({});
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const selectedKey = relationKey(value);
  const selectedKeys = relationKeys(value);
  const limit = Math.min(Math.max(maxItems, 1), 100);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!targetModel) {
      setOptions([]);
      setHasNext(false);
      setError("Relation target model is not configured.");
      return;
    }
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          limit: String(PAGE_SIZE + 1),
          offset: String(page * PAGE_SIZE),
          sortBy: "title",
          sortOrder: "asc",
          ...(search ? { search } : {}),
        });
        const result = await apiRequest<{ data?: RelationOption[] }>(
          "/content-models/" + encodeURIComponent(targetModel) + "/entries?" + query.toString(),
        );
        if (!active) return;
        const found = result.data ?? [];
        const visible = found.slice(0, PAGE_SIZE);
        setOptions(visible);
        setHasNext(found.length > PAGE_SIZE);
        setKnown((previous) => {
          const updated = { ...previous };
          for (const option of visible) {
            updated[option.id] = option;
            updated[option.slug] = option;
          }
          return updated;
        });
      } catch (reason) {
        if (!active) return;
        setOptions([]);
        setHasNext(false);
        setError(reason instanceof Error ? reason.message : "Unable to load related entries.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [targetModel, page, search, retry]);

  const findOption = (key: string) =>
    options.find((item) => item.id === key || item.slug === key) ?? known[key];
  const storedTitle = (index: number) => {
    if (!Array.isArray(value)) return undefined;
    const item: unknown = value[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
    const title = (item as Record<string, unknown>).title;
    return typeof title === "string" ? title : undefined;
  };

  return (
    <fieldset disabled={!targetModel} className="min-w-0 space-y-3">
      <legend className="text-sm font-medium text-foreground">
        {fieldName} {required && "*"} ({multiple ? "Multiple relations" : "Relation"})
      </legend>
      <label className="block text-xs text-muted-foreground">
        Search related entries
        <input type="search" value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search by title, slug or content"
          className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm" />
      </label>
      {multiple ? (
        <>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {selectedKeys.length} selected (maximum {limit})
          </p>
          {selectedKeys.length > 0 && (
            <ol aria-label="Selected relations" className="space-y-1">
              {selectedKeys.map((key, index) => (
                <li key={key + "-" + index} className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm">
                  <span dir="auto" className="truncate">
                    {findOption(key)?.title ?? storedTitle(index) ?? key}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" disabled={index === 0} aria-label={"Move " + key + " up"}
                      onClick={() => {
                        const next = [...selectedKeys];
                        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                        onChange(next);
                      }} className="rounded border px-2 disabled:opacity-40">↑</button>
                    <button type="button" disabled={index === selectedKeys.length - 1}
                      aria-label={"Move " + key + " down"} onClick={() => {
                        const next = [...selectedKeys];
                        [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                        onChange(next);
                      }} className="rounded border px-2 disabled:opacity-40">↓</button>
                    <button type="button" aria-label={"Remove " + key}
                      onClick={() => onChange(selectedKeys.filter((_, i) => i !== index))}
                      className="rounded border px-2">Remove</button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-border p-2">
            {options.map((option) => {
              const checked = selectedKeys.includes(option.id) || selectedKeys.includes(option.slug);
              return (
                <label key={option.id} className="flex gap-2 rounded px-2 py-1 text-sm hover:bg-muted" dir="auto">
                  <input type="checkbox" checked={checked}
                    disabled={!checked && selectedKeys.length >= limit}
                    onChange={(event) => onChange(event.target.checked
                      ? [...selectedKeys, option.id]
                      : selectedKeys.filter((key) => key !== option.id && key !== option.slug))} />
                  <span className="truncate">{option.title} ({option.slug})</span>
                </label>
              );
            })}
          </div>
        </>
      ) : (
        <select required={required} aria-label={"Select " + fieldName + " relation"}
          value={findOption(selectedKey)?.id ?? selectedKey}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-border bg-background p-2 text-sm">
          <option value="">No related entry</option>
          {selectedKey && !options.some((item) => item.id === selectedKey || item.slug === selectedKey) && (
            <option value={findOption(selectedKey)?.id ?? selectedKey}>
              {findOption(selectedKey)?.title ?? selectedKey} (current selection)
            </option>
          )}
          {options.map((item) => (
            <option key={item.id} value={item.id}>{item.title} ({item.slug})</option>
          ))}
        </select>
      )}
      {error && <p role="alert" className="text-sm text-destructive">
        {error} <button type="button" onClick={() => setRetry((n) => n + 1)}
          className="underline">Retry</button>
      </p>}
      {loading && <p role="status" className="text-xs text-muted-foreground">Loading related entries…</p>}
      {!loading && !error && options.length === 0 &&
        <p className="text-xs text-muted-foreground">No matching entries. Existing selections are preserved.</p>}
      <nav aria-label={"Pages for " + fieldName + " relations"}
        className="flex items-center justify-between gap-2">
        <button type="button" disabled={loading || page === 0}
          onClick={() => setPage((n) => Math.max(0, n - 1))}
          className="rounded border px-3 py-1 text-sm disabled:opacity-40">Previous</button>
        <span className="text-xs text-muted-foreground">Page {page + 1}</span>
        <button type="button" disabled={loading || !hasNext}
          onClick={() => setPage((n) => n + 1)}
          className="rounded border px-3 py-1 text-sm disabled:opacity-40">Next</button>
      </nav>
    </fieldset>
  );
}
