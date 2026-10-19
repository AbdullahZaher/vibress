import { useEffect, useRef, useState } from "react";
import {
  AdminIntegration,
  AdminApiKey,
  AdminWebhookEndpoint,
  listIntegrationsApi,
  listApiKeysApi,
  listWebhookEndpointsApi,
} from "../lib/api";

import { Server, Key, Webhook } from "lucide-react";
import { IntegrationsPanel } from "./platform/IntegrationsPanel";
import { ApiKeysPanel } from "./platform/ApiKeysPanel";
import { WebhooksPanel } from "./platform/WebhooksPanel";

type Tab = "integrations" | "apikeys" | "webhooks";

export function PlatformSettings() {
  const [tab, setTab] = useState<Tab>("integrations");
  const [integrations, setIntegrations] = useState<AdminIntegration[]>([]);
  const [apiKeys, setApiKeys] = useState<AdminApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<AdminWebhookEndpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = async () => {
    const generation = ++refreshGeneration.current;
    try {
      const [i, k, w] = await Promise.all([
        listIntegrationsApi(),
        listApiKeysApi(),
        listWebhookEndpointsApi(),
      ]);
      if (generation !== refreshGeneration.current) return;
      setIntegrations(i.integrations);
      setApiKeys(k.keys);
      setWebhooks(w.endpoints);
      setError(null);
    } catch (err: unknown) {
      if (generation === refreshGeneration.current) {
        setError(
          err instanceof Error ? err.message : "Failed to load platform data",
        );
      }
    }
  };

  useEffect(() => {
    void refresh();
    const onPublicationChanged = () => {
      // Clear one-time integration secrets whenever the publication changes.
      setNewSecret(null);
      void refresh();
    };
    window.addEventListener("vibress:publication-changed", onPublicationChanged);
    return () => {
      refreshGeneration.current += 1;
      window.removeEventListener("vibress:publication-changed", onPublicationChanged);
    };
  }, []);

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Integrations & Developer Platform
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

      {newSecret && (
        <div className="p-4 rounded-lg bg-card border border-primary text-xs font-mono space-y-1">
          <p className="text-primary font-bold font-sans">
            API Key Secret (Save this now!):
          </p>
          <p className="select-all text-foreground font-bold">{newSecret}</p>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setTab("integrations")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "integrations"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Server className="h-3.5 w-3.5" /> Integrations ({integrations.length}
          )
        </button>
        <button
          onClick={() => setTab("apikeys")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "apikeys"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Key className="h-3.5 w-3.5" /> API Keys ({apiKeys.length})
        </button>
        <button
          onClick={() => setTab("webhooks")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
            tab === "webhooks"
              ? "bg-card text-foreground border border-border shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Webhook className="h-3.5 w-3.5" /> Webhooks ({webhooks.length})
        </button>

      </div>

      {/* Panels stay mounted so form state survives tab switches */}
      <div className={tab === "integrations" ? "" : "hidden"}>
        <IntegrationsPanel
          integrations={integrations}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>
      <div className={tab === "apikeys" ? "" : "hidden"}>
        <ApiKeysPanel
          apiKeys={apiKeys}
          onError={setError}
          onMessage={setMessage}
          onNewSecret={setNewSecret}
          onChanged={refresh}
        />
      </div>
      <div className={tab === "webhooks" ? "" : "hidden"}>
        <WebhooksPanel
          webhooks={webhooks}
          onError={setError}
          onMessage={setMessage}
          onChanged={refresh}
        />
      </div>

    </div>
  );
}
