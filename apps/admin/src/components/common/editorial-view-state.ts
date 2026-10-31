/** URL-backed editorial view state, with a same-tab fallback when returning from an editor.
 * Only presentation filters are stored. No article bodies or API credentials are persisted.
 */
export interface EditorialViewState {
  status: string;
  search: string;
  page: number;
  pageSize: number;
  sortBy: "updatedAt" | "createdAt" | "publishedAt" | "title";
  sortOrder: "asc" | "desc";
}

export type EditorialResource = "posts" | "pages";
const statuses = new Set(["all", "draft", "in_review", "changes_requested", "scheduled", "published"]);
const sorts = new Set(["updatedAt", "createdAt", "publishedAt", "title"]);
const keys = ["v_search", "v_status", "v_page", "v_size", "v_sort", "v_order"];

const safePage = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9999 ? parsed : 0;
};
const safeSize = (value: unknown) => {
  const parsed = Number(value);
  return parsed === 25 || parsed === 50 || parsed === 100 ? parsed : 25;
};
const safeStatus = (value: unknown) => typeof value === "string" && statuses.has(value) ? value : "all";
const safeSort = (value: unknown): EditorialViewState["sortBy"] =>
  typeof value === "string" && sorts.has(value) ? value as EditorialViewState["sortBy"] : "updatedAt";

export function readEditorialViewState(resource: EditorialResource, forcedStatus = "all"): EditorialViewState {
  const defaults: EditorialViewState = {
    status: safeStatus(forcedStatus), search: "", page: 0, pageSize: 25, sortBy: "updatedAt", sortOrder: "desc",
  };
  if (typeof window === "undefined") return defaults;
  if (!window.location.pathname.startsWith(`/admin/${resource}`)) return defaults;

  const params = new URLSearchParams(window.location.search);
  const hasUrlState = keys.some((key) => params.has(key));
  let saved: Partial<EditorialViewState> = {};
  if (!hasUrlState) {
    try {
      const raw = window.sessionStorage.getItem(`vibress:editorial:${resource}:${window.location.pathname}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") saved = parsed as Partial<EditorialViewState>;
      }
    } catch { /* unavailable/disabled storage: use current URL only */ }
  }

  const view: EditorialViewState = hasUrlState ? {
    status: safeStatus(params.get("v_status")),
    search: (params.get("v_search") ?? "").slice(0, 200),
    page: safePage(params.get("v_page")),
    pageSize: safeSize(params.get("v_size")),
    sortBy: safeSort(params.get("v_sort")),
    sortOrder: params.get("v_order") === "asc" ? "asc" : "desc",
  } : {
    status: safeStatus(saved.status),
    search: typeof saved.search === "string" ? saved.search.slice(0, 200) : "",
    page: safePage(saved.page),
    pageSize: safeSize(saved.pageSize),
    sortBy: safeSort(saved.sortBy),
    sortOrder: saved.sortOrder === "asc" ? "asc" : "desc",
  };

  if (forcedStatus !== "all") {
    view.status = defaults.status;
    view.page = 0;
  }
  return view;
}

export function saveEditorialViewState(resource: EditorialResource, view: EditorialViewState): void {
  if (typeof window === "undefined") return;
  const root = `/admin/${resource}`;
  // Quick-view routes have their own fixed statuses and must not overwrite the main view.
  if (window.location.pathname !== root) return;
  const state: EditorialViewState = {
    status: safeStatus(view.status),
    search: view.search.slice(0, 200),
    page: safePage(view.page),
    pageSize: safeSize(view.pageSize),
    sortBy: safeSort(view.sortBy),
    sortOrder: view.sortOrder === "asc" ? "asc" : "desc",
  };
  try {
    window.sessionStorage.setItem(`vibress:editorial:${resource}:${root}`, JSON.stringify(state));
  } catch { /* storage may be disabled, but URL state still works */ }

  const url = new URL(window.location.href);
  for (const key of keys) url.searchParams.delete(key);
  if (state.search) url.searchParams.set("v_search", state.search);
  if (state.status !== "all") url.searchParams.set("v_status", state.status);
  if (state.page > 0) url.searchParams.set("v_page", String(state.page));
  if (state.pageSize !== 25) url.searchParams.set("v_size", String(state.pageSize));
  if (state.sortBy !== "updatedAt") url.searchParams.set("v_sort", state.sortBy);
  if (state.sortOrder !== "desc") url.searchParams.set("v_order", state.sortOrder);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
