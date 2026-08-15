import { useEffect, useState } from "react";
import {
  AdminNewsletter,
  AdminNewsletterSend,
  AdminSuppression,
  listNewslettersApi,
  listNewsletterSendsApi,
  listSuppressionsApi,
} from "../lib/api";

import { Mail, Send, ShieldX } from "lucide-react";
import { NewslettersListPanel } from "./newsletters/NewslettersListPanel";
import { BroadcastsPanel } from "./newsletters/BroadcastsPanel";
import { SuppressionsPanel } from "./newsletters/SuppressionsPanel";

type Tab = "newsletters" | "sends" | "suppressions";

export function NewslettersSettings() {
  const [tab, setTab] = useState<Tab>("newsletters");
  const [newsletters, setNewsletters] = useState<AdminNewsletter[]>([]);
  const [sends, setSends] = useState<AdminNewsletterSend[]>([]);
  const [suppressions, setSuppressions] = useState<AdminSuppression[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sendNlId, setSendNlId] = useState("");

  const refresh = async () => {
    try {
      const [n, s, sup] = await Promise.all([
        listNewslettersApi(true),
        listNewsletterSendsApi(),
        listSuppressionsApi(),
      ]);
      setNewsletters(n.newsletters);
      setSends(s.sends);
      setSuppressions(sup.suppressions);
      if (n.newsletters.length > 0 && n.newsletters[0] && !sendNlId) {
        setSendNlId(n.newsletters[0].id);
      }
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load newsletters",
      );
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Newsletters & Email Broadcasts
        </h1>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {message && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          {message}
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTab("newsletters")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "newsletters"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mail className="h-3.5 w-3.5" /> Newsletters ({newsletters.length})
        </button>
        <button
          onClick={() => setTab("sends")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "sends"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Send className="h-3.5 w-3.5" /> Broadcasts ({sends.length})
        </button>
        <button
          onClick={() => setTab("suppressions")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "suppressions"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldX className="h-3.5 w-3.5" /> Suppressions (
          {suppressions.length})
        </button>
      </div>

      {/* Panels stay mounted so form state survives tab switches */}
      <div className={tab === "newsletters" ? "" : "hidden"}>
        <NewslettersListPanel
          newsletters={newsletters}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
      <div className={tab === "sends" ? "" : "hidden"}>
        <BroadcastsPanel
          newsletters={newsletters}
          sends={sends}
          sendNlId={sendNlId}
          onSendNlIdChange={setSendNlId}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
      <div className={tab === "suppressions" ? "" : "hidden"}>
        <SuppressionsPanel
          suppressions={suppressions}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
    </div>
  );
}
