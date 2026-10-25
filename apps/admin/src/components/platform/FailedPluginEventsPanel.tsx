import { useEffect, useRef, useState } from "react";
import {
  listFailedPluginEventsApi, replayFailedPluginEventApi,
  type AdminFailedPluginEvent,
} from "../../lib/api";
import { useAdminLocale } from "../../lib/admin-locale";
import { Button } from "../ui/button";

interface Props {
  pluginId: string;
  onError: (message: string) => void;
}

/** Operator-only view. Server always rechecks Staff, plugin and publication
 * permissions. No event payload, error stack or cross-tenant queue scan. */
export function FailedPluginEventsPanel({ pluginId, onError }: Props) {
  const { tr } = useAdminLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminFailedPluginEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const reset = () => {
      generation.current += 1;
      setOpen(false);
      setItems([]);
      setNextOffset(null);
      setArmed(null);
      setRetrying(null);
      setLoading(false);
    };
    window.addEventListener("vibress:publication-changed", reset);
    return () => {
      generation.current += 1;
      window.removeEventListener("vibress:publication-changed", reset);
    };
  }, [pluginId]);

  const load = async (offset: number) => {
    if (loading || retrying) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await listFailedPluginEventsApi(pluginId, offset);
      if (current !== generation.current) return;
      setItems((previous) => offset === 0
        ? result.items : [...previous, ...result.items]);
      setNextOffset(result.nextOffset > offset &&
        result.nextOffset - offset === 25 ? result.nextOffset : null);
    } catch {
      if (current === generation.current) {
        // Provider errors may include operator paths, queue diagnostics or
        // private event data. Never display untrusted error strings.
        onError(tr("Failed to load plugin events"));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };

  const replay = async (eventId: string) => {
    if (retrying || loading) return;
    const current = ++generation.current;
    setRetrying(eventId);
    try {
      await replayFailedPluginEventApi(pluginId, eventId);
      if (current !== generation.current) return;
      setItems((previous) => previous.filter((item) => item.eventId !== eventId));
      setArmed(null);
      setNextOffset(null);
    } catch {
      if (current === generation.current) {
        onError(tr("Plugin event replay failed"));
      }
    } finally {
      if (current === generation.current) setRetrying(null);
    }
  };

  return (
    <section className="space-y-2" aria-label={tr("Failed plugin events")}>
      <Button
        variant="outline" size="sm" disabled={loading || retrying !== null}
        aria-expanded={open} aria-controls={`plugin-failed-events-${pluginId}`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setArmed(null);
          if (next) void load(0);
        }}
      >
        {tr("Failed plugin events")}
      </Button>
      {open && (
        <div id={`plugin-failed-events-${pluginId}`} className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {tr("Only events from this publication are shown. A retry may repeat side effects.")}
          </p>
          {loading && <p role="status" className="text-xs">{tr("Loading failed events...")}</p>}
          {!loading && items.length === 0 && (
            <p role="status" className="text-xs">{tr("No failed events in this page.")}</p>
          )}
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.jobId} className="rounded-md border border-border p-2 space-y-2">
                <div className="text-xs font-mono break-all" dir="ltr">{item.eventId}</div>
                <p className="text-xs text-muted-foreground">
                  {tr("Attempts")}: {item.attemptsMade}
                </p>
                {armed === item.eventId && (
                  <p role="alert" className="text-xs text-destructive">
                    {tr("Retrying may run the same operation again. Confirm only after reviewing the side effects.")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {armed === item.eventId ? (
                    <>
                      <Button variant="outline" size="sm"
                        disabled={retrying !== null || loading}
                        onClick={() => { void replay(item.eventId); }}>
                        {tr("Confirm replay")}
                      </Button>
                      <Button variant="outline" size="sm"
                        disabled={retrying !== null}
                        onClick={() => setArmed(null)}>
                        {tr("Cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm"
                      disabled={retrying !== null || loading}
                      onClick={() => setArmed(item.eventId)}>
                      {tr("Review replay")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {nextOffset !== null && (
            <Button variant="outline" size="sm"
              disabled={loading || retrying !== null}
              onClick={() => { void load(nextOffset); }}>
              {tr("Load more events")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
