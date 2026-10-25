import { useEffect, useRef, useState } from "react";
import {
  listPluginActivityApi, type AdminPluginActivity,
} from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";

interface Props {
  pluginId: string;
  onError: (message: string) => void;
}

const ACTION_LABEL: Record<AdminPluginActivity["action"], string> = {
  "plugin.publication_settings_updated": "Plugin settings updated",
  "plugin.publication_secret_revoked": "Plugin secret revoked",
  "plugin.event_replay_requested": "Plugin event replay requested",
};

/** The server provides curated action + timestamp only. Never display raw
 * audit metadata, actors, event IDs or private plugin-provided content. */
export function PluginActivityPanel({ pluginId, onError }: Props) {
  const { tr, formatDate } = useAdminLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminPluginActivity[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const reset = () => {
      generation.current += 1;
      setOpen(false);
      setItems([]);
      setNextOffset(null);
      setLoading(false);
    };
    window.addEventListener("vibress:publication-changed", reset);
    return () => {
      generation.current += 1;
      window.removeEventListener("vibress:publication-changed", reset);
    };
  }, [pluginId]);

  const load = async (offset: number) => {
    if (loading) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const page = await listPluginActivityApi(pluginId, offset);
      if (current !== generation.current) return;
      setItems((previous) => offset === 0
        ? page.items : [...previous, ...page.items]);
      setNextOffset(page.nextOffset);
    } catch {
      if (current === generation.current) {
        onError(tr("Failed to load plugin activity"));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };

  return (
    <section className="space-y-2" aria-label={tr("Plugin audit history")}>
      <Button type="button" variant="outline" size="sm"
        disabled={loading}
        aria-expanded={open}
        aria-controls={`plugin-activity-${pluginId}`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load(0);
        }}>
        {tr("Plugin audit history")}
      </Button>
      {open && (
        <div id={`plugin-activity-${pluginId}`} className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {tr("This history includes selected audited actions for the current publication, not every plugin lifecycle event.")}
          </p>
          {loading && <p role="status" className="text-xs">
            {tr("Loading plugin activity...")}
          </p>}
          {!loading && items.length === 0 && (
            <p role="status" className="text-xs">{tr("No audited plugin activity on this page.")}</p>
          )}
          <ol className="space-y-2">
            {items.map((item, i) => (
              <li key={`${item.createdAt}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
                <span className="text-sm">{tr(ACTION_LABEL[item.action])}</span>
                <time className="text-xs text-muted-foreground"
                  dateTime={item.createdAt} dir="auto">
                  {formatDate(item.createdAt)}
                </time>
              </li>
            ))}
          </ol>
          {nextOffset !== null && (
            <Button type="button" variant="outline" size="sm"
              disabled={loading} onClick={() => { void load(nextOffset); }}>
              {tr("Load more activity")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
