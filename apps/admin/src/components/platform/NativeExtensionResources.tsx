import { useEffect, useState } from "react";
import type { ExtensionNativeDataDiscoveryV1, ExtensionNativeDataPageV1 } from "@vibress/api-contracts";
import { ApiError, readNativeExtensionDataRegistryApi, readNativeExtensionResourceApi } from "../../lib/api";
import { getActivePublicationId } from "../../lib/api/client";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Resource = ExtensionNativeDataDiscoveryV1["resources"][number];
type State = { kind: "loading" | "absent" | "error" }
  | { kind: "ready"; resources: readonly Resource[] };
type Page = { resourceId: string; data: ExtensionNativeDataPageV1 };

const REFRESH_MS = 30_000;

/**
 * NUI-04 Host-only inert resource table. Unbound resources remain invisible.
 * All reads are independently authorized on the Host with publication scope.
 */
export function NativeExtensionResources({ pluginId, viewId, publicationId }: {
  pluginId: string; viewId: string; publicationId: string | null;
}) {
  const { tr } = useAdminLocale();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [resourceId, setResourceId] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [field, setField] = useState("");
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<{ field: string; term: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setPage(null);
    setHistory([undefined]);
    setFilter(null);
    setError("");
    void readNativeExtensionDataRegistryApi(pluginId).then((result) => {
      if (cancelled || getActivePublicationId() !== publicationId) return;
      const resources = result.resources.filter((resource) => resource.viewId === viewId);
      if (resources.length === 0) { setState({ kind: "absent" }); return; }
      setResourceId(resources[0]!.id);
      setField(resources[0]!.textFilters?.[0] ?? "");
      setTerm("");
      setState({ kind: "ready", resources });
    }).catch((cause: unknown) => {
      if (cancelled || getActivePublicationId() !== publicationId) return;
      setState(cause instanceof ApiError && cause.statusCode === 404
        ? { kind: "absent" } : { kind: "error" });
    });
    return () => { cancelled = true; };
  }, [pluginId, viewId, publicationId]);

  const resource = state.kind === "ready"
    ? state.resources.find((item) => item.id === resourceId) : undefined;
  const cursor = history[history.length - 1];
  useEffect(() => {
    if (!resource) return;
    let cancelled = false;
    setPage(null);
    setFetching(true);
    setError("");
    void readNativeExtensionResourceApi(pluginId, resource.id, {
      limit: 20,
      ...(cursor ? { cursor } : {}),
      ...(filter ? { filterField: filter.field, filterValue: filter.term } : {}),
    }).then((data) => {
      if (!cancelled && getActivePublicationId() === publicationId) {
        setPage({ resourceId: resource.id, data });
      }
    }).catch(() => {
      if (!cancelled) { setPage(null); setError(tr("Unable to load plugin records.")); }
    }).finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [resourceId, cursor, filter, revision, state.kind, pluginId, publicationId]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  if (getActivePublicationId() !== publicationId) return null;
  if (state.kind === "loading" || state.kind === "absent") return null;
  if (state.kind === "error") return <p role="alert">{tr("Unable to load plugin records.")}</p>;
  if (!resource) return null;
  const current = page?.resourceId === resource.id ? page.data : null;
  const prefix = "plugin-data-" + pluginId + "-" + resource.id;

  return (
    <section aria-label={tr("Plugin records")} className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 dir="auto" className="text-base font-semibold">{resource.id}</h2>
        <div className="flex flex-wrap gap-2">
          {state.resources.length > 1 && (
            <select value={resource.id} aria-label={tr("Choose plugin resource")}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              onChange={(event) => {
                const next = state.resources.find((item) => item.id === event.target.value);
                setResourceId(event.target.value);
                setHistory([undefined]); setFilter(null); setTerm("");
                setField(next?.textFilters?.[0] ?? "");
              }}>
              {state.resources.map((item) => <option value={item.id} key={item.id}>{item.id}</option>)}
            </select>
          )}
          <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>
            {tr("Refresh")}
          </Button>
        </div>
      </div>
      {(resource.textFilters?.length ?? 0) > 0 && (
        <form className="flex items-end flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          setHistory([undefined]);
          setFilter(term ? { field, term } : null);
        }}>
          <div>
            <label htmlFor={prefix + "-field"} className="block text-xs mb-1">{tr("Filter field")}</label>
            <select id={prefix + "-field"} value={field}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              onChange={(event) => setField(event.target.value)}>
              {resource.textFilters?.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={prefix + "-term"} className="block text-xs mb-1">{tr("Exact value")}</label>
            <Input id={prefix + "-term"} dir="auto" maxLength={256} value={term}
              onChange={(event) => setTerm(event.target.value)} />
          </div>
          <Button size="sm" type="submit" variant="outline">{tr("Apply filter")}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {fetching && <p role="status" className="text-sm">{tr("Loading plugin records...")}</p>}
      {current && <>
        <Table>
          <TableHeader><TableRow>
            <TableHead scope="col">{tr("Record ID")}</TableHead>
            {resource.fields.map((key) => <TableHead key={key} scope="col" dir="auto">{key}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>{current.items.map((item) => <TableRow key={item.id}>
            <TableCell dir="auto">{item.id}</TableCell>
            {resource.fields.map((key) => <TableCell key={key} dir="auto"
              className="max-w-xs break-words">{item.fields[key] == null
                ? "—" : String(item.fields[key])}</TableCell>)}
          </TableRow>)}</TableBody>
        </Table>
        {current.items.length === 0 && <p className="text-sm text-muted-foreground">{tr("No plugin records.")}</p>}
        <div className="flex justify-between items-center gap-2">
          <p className="text-xs text-muted-foreground" role="status">{tr("Page")} {history.length}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm"
              disabled={history.length < 2 || fetching}
              onClick={() => setHistory((value) => value.slice(0, -1))}>{tr("Previous")}</Button>
            <Button type="button" variant="outline" size="sm"
              disabled={!current.nextCursor || fetching}
              onClick={() => {
                if (current.nextCursor) setHistory((value) => [...value, current.nextCursor]);
              }}>{tr("Next")}</Button>
          </div>
        </div>
      </>}
    </section>
  );
}
