import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Input } from "../../ui/input";
import {
  Cpu,
  Key,
  Webhook,
  RefreshCw,
  X,
  Plus,
  Sparkles,
  Image,
  Zap,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import {
  listApiKeysApi,
  createApiKeyApi,
  revokeApiKeyApi,
  listWebhookEndpointsApi,
  createWebhookEndpointApi,
  deleteWebhookEndpointApi,
  listPluginsApi,
  AdminApiKey,
  AdminWebhookEndpoint,
} from "../../../lib/api";

interface IntegrationsPlatformCardProps {
  isHighlighted?: boolean | undefined;
}

export const IntegrationsPlatformCard: React.FC<
  IntegrationsPlatformCardProps
> = ({ isHighlighted }) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [keys, setKeys] = useState<AdminApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<AdminWebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(false);

  // New API Key Modal state
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keySaving, setKeySaving] = useState(false);

  // New Webhook Modal state
  const [isCreatingWebhook, setIsCreatingWebhook] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      listApiKeysApi().catch(() => ({ keys: [] })),
      listWebhookEndpointsApi().catch(() => ({ endpoints: [] })),
      listPluginsApi().catch(() => ({ plugins: [] })),
    ])
      .then(([k, w]) => {
        setKeys(k.keys || []);
        setWebhooks(w.endpoints || []);
      })
      .finally(() => setLoading(false));
  };

  const handleOpen = () => {
    setIsDrawerOpen(true);
    loadData();
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName) return;
    setKeySaving(true);
    try {
      const res = await createApiKeyApi({
        name: keyName.trim(),
        scopes: ["*"],
      });
      setCreatedSecret(res.key.secret);
      setKeyName("");
      loadData();
    } catch {
      // Keep state
    } finally {
      setKeySaving(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await revokeApiKeyApi(id);
      loadData();
    } catch {
      // Keep state
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookName || !webhookUrl) return;
    setWebhookSaving(true);
    try {
      await createWebhookEndpointApi({
        name: webhookName.trim(),
        url: webhookUrl.trim(),
        eventTypes: ["post.published", "member.created"],
      });
      setIsCreatingWebhook(false);
      setWebhookName("");
      setWebhookUrl("");
      loadData();
    } catch {
      // Keep state
    } finally {
      setWebhookSaving(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await deleteWebhookEndpointApi(id);
      loadData();
    } catch {
      // Keep state
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeKeysCount = keys.filter((k) => !k.revokedAt).length;

  return (
    <>
      <SettingsCard id="advanced-integrations" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Cpu className="h-4 w-4" />}
          title="Developer platform & integrations"
          description="Manage built-in services (Unsplash, Zapier), custom API keys, and real-time webhook endpoints."
          currentValue={
            <div className="flex items-center gap-1 font-mono text-xs">
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary border-primary/20"
              >
                {activeKeysCount} Keys
              </Badge>
              <span className="text-muted-foreground">•</span>
              <Badge
                variant="secondary"
                className="bg-muted text-muted-foreground"
              >
                {webhooks.length} Webhooks
              </Badge>
            </div>
          }
          actionLabel="Manage integrations"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Integrations Slide-over Drawer */}
      <SettingsModalPortal
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Integrations & Developer Platform
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Built-in Services Grid */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Built-in
                  Integrations
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-border/60 bg-muted/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs border border-border/40">
                        <Image className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-foreground">
                          Unsplash
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Free high-res photos
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="text-[10px] text-emerald-500 bg-emerald-500/10"
                    >
                      Active
                    </Badge>
                  </div>

                  <div className="p-3.5 rounded-xl border border-border/60 bg-muted/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold text-xs border border-amber-500/20">
                        <Zap className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-foreground">
                          Zapier
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Automations & sync
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      Available
                    </Badge>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-xs">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading
                  platform records...
                </div>
              ) : (
                <>
                  {/* API Keys Section */}
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Key className="h-3.5 w-3.5 text-primary" /> Custom API
                        Keys
                      </h4>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsCreatingKey(true)}
                        className="h-7 text-xs gap-1 cursor-pointer bg-card"
                      >
                        <Plus className="h-3 w-3" /> New Key
                      </Button>
                    </div>

                    {/* Created Secret Display Alert */}
                    {createdSecret && (
                      <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 space-y-2 animate-in fade-in">
                        <p className="text-xs font-bold text-emerald-500">
                          API Key Created Successfully!
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Please copy your API key secret now. You will not be
                          able to see it again!
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={createdSecret}
                            readOnly
                            className="font-mono text-xs h-8 bg-card"
                          />
                          <Button
                            size="sm"
                            onClick={() => copyToClipboard(createdSecret)}
                            className="h-8 text-xs shrink-0 cursor-pointer"
                          >
                            {copied ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            {copied ? "Copied" : "Copy"}
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCreatedSecret(null)}
                          className="text-[10px] h-6 cursor-pointer"
                        >
                          I have saved my key
                        </Button>
                      </div>
                    )}

                    {/* New Key Form */}
                    {isCreatingKey && !createdSecret && (
                      <form
                        onSubmit={handleCreateKey}
                        className="p-3.5 rounded-xl border border-primary/40 bg-primary/5 space-y-2.5"
                      >
                        <h5 className="text-xs font-bold text-foreground">
                          Generate New API Key
                        </h5>
                        <Input
                          placeholder="Key Name (e.g. Mobile App Backend)"
                          value={keyName}
                          onChange={(e) => setKeyName(e.target.value)}
                          className="text-xs h-8 bg-card"
                          required
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setIsCreatingKey(false)}
                            className="text-xs h-7 cursor-pointer"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={keySaving}
                            className="text-xs h-7 cursor-pointer"
                          >
                            {keySaving ? "Generating..." : "Generate Key"}
                          </Button>
                        </div>
                      </form>
                    )}

                    <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card overflow-hidden">
                      {keys.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                          No API keys created yet.
                        </div>
                      ) : (
                        keys.map((k) => (
                          <div
                            key={k.id}
                            className="p-3.5 flex items-center justify-between text-xs"
                          >
                            <div>
                              <p className="font-semibold text-foreground">
                                {k.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-mono">
                                {k.prefix}••••••••
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={k.revokedAt ? "outline" : "secondary"}
                                className="text-[10px] font-mono"
                              >
                                {k.revokedAt ? "Revoked" : "Active"}
                              </Badge>
                              {!k.revokedAt && (
                                <button
                                  type="button"
                                  onClick={() => handleRevokeKey(k.id)}
                                  className="text-muted-foreground hover:text-destructive p-1 rounded-md cursor-pointer"
                                  title="Revoke key"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Webhooks Section */}
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Webhook className="h-3.5 w-3.5 text-primary" />{" "}
                        Outgoing Webhooks
                      </h4>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsCreatingWebhook(true)}
                        className="h-7 text-xs gap-1 cursor-pointer bg-card"
                      >
                        <Plus className="h-3 w-3" /> Add Webhook
                      </Button>
                    </div>

                    {/* New Webhook Form */}
                    {isCreatingWebhook && (
                      <form
                        onSubmit={handleCreateWebhook}
                        className="p-3.5 rounded-xl border border-primary/40 bg-primary/5 space-y-2.5"
                      >
                        <h5 className="text-xs font-bold text-foreground">
                          Register Webhook Endpoint
                        </h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input
                            placeholder="Webhook Name"
                            value={webhookName}
                            onChange={(e) => setWebhookName(e.target.value)}
                            className="text-xs h-8 bg-card"
                            required
                          />
                          <Input
                            type="url"
                            placeholder="https://yourserver.com/webhook"
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                            className="text-xs h-8 bg-card font-mono"
                            required
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setIsCreatingWebhook(false)}
                            className="text-xs h-7 cursor-pointer"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={webhookSaving}
                            className="text-xs h-7 cursor-pointer"
                          >
                            {webhookSaving ? "Saving..." : "Add Endpoint"}
                          </Button>
                        </div>
                      </form>
                    )}

                    <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card overflow-hidden">
                      {webhooks.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                          No webhook endpoints registered.
                        </div>
                      ) : (
                        webhooks.map((w) => (
                          <div
                            key={w.id}
                            className="p-3.5 flex items-center justify-between text-xs"
                          >
                            <div>
                              <p className="font-semibold text-foreground">
                                {w.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-mono truncate max-w-xs">
                                {w.url}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {w.enabled ? "Active" : "Disabled"}
                              </Badge>
                              <button
                                type="button"
                                onClick={() => handleDeleteWebhook(w.id)}
                                className="text-muted-foreground hover:text-destructive p-1 rounded-md cursor-pointer"
                                title="Delete webhook"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button
                size="sm"
                onClick={() => setIsDrawerOpen(false)}
                className="text-xs cursor-pointer"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
