import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listStorageConfigurationsApi,
  createStorageConfigurationApi,
  testStorageConnectionApi,
  activateStorageConfigurationApi,
  deleteStorageConfigurationApi,
  CreateStorageConfigurationInput,
  S3ProviderTypeDto,
} from "../lib/api";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Plug,
} from "lucide-react";

const S3_PRESET_DEFAULTS: Record<
  string,
  { region: string; endpoint: string; forcePathStyle: boolean }
> = {
  "aws-s3": { region: "us-east-1", endpoint: "", forcePathStyle: false },
  "cloudflare-r2": {
    region: "auto",
    endpoint: "https://<account_id>.r2.cloudflarestorage.com",
    forcePathStyle: true,
  },
  "digitalocean-spaces": {
    region: "nyc3",
    endpoint: "https://nyc3.digitaloceanspaces.com",
    forcePathStyle: false,
  },
  wasabi: {
    region: "us-east-1",
    endpoint: "https://s3.wasabisys.com",
    forcePathStyle: false,
  },
  "backblaze-b2": {
    region: "us-west-004",
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    forcePathStyle: false,
  },
  hetzner: {
    region: "hel1",
    endpoint: "https://hel1.your-objectstorage.com",
    forcePathStyle: false,
  },
  minio: {
    region: "us-east-1",
    endpoint: "http://127.0.0.1:9000",
    forcePathStyle: true,
  },
  custom: { region: "us-east-1", endpoint: "", forcePathStyle: false },
};

export const StorageSettings: React.FC = () => {
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState("My Storage Provider");
  const [providerType, setProviderType] = useState<string>("minio");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:9000");
  const [region, setRegion] = useState("us-east-1");
  const [bucket, setBucket] = useState("vibress-bucket");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(true);

  // UI state
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["storage-configurations"],
    queryFn: () => listStorageConfigurationsApi(),
  });

  const handlePresetChange = (type: string) => {
    setProviderType(type);
    const defaults = S3_PRESET_DEFAULTS[type];
    if (defaults) {
      setRegion(defaults.region);
      setEndpoint(defaults.endpoint);
      setForcePathStyle(defaults.forcePathStyle);
    }
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateStorageConfigurationInput) =>
      createStorageConfigurationApi(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storage-configurations"] });
      setFormError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setFormError(e.message || "Creation failed");
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateStorageConfigurationApi(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["storage-configurations"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStorageConfigurationApi(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["storage-configurations"] }),
  });

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testStorageConnectionApi({
        providerType: providerType as S3ProviderTypeDto,
        endpoint: endpoint || undefined,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
      });
      setTestResult({
        success: res.result.connected,
        message: res.result.connected
          ? `Successfully connected to ${res.result.bucket}`
          : "Connection failed",
      });
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      setTestResult({
        success: false,
        message: e.message || "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      providerType: providerType as S3ProviderTypeDto,
      endpoint: endpoint || undefined,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
    });
  };

  const configs = data?.configurations || [];

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Storage Engine Configuration
        </h1>
      </div>

      {formError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {formError}
        </div>
      )}

      {/* Active Storage Configurations */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          CONFIGURED STORAGE PROVIDERS
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isLoading ? (
            <div className="col-span-2 p-8 text-center text-xs text-muted-foreground">
              Loading storage providers...
            </div>
          ) : configs.length === 0 ? (
            <div className="col-span-2 p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
              No custom S3 storage configured. Default local storage is active.
            </div>
          ) : (
            configs.map((config) => (
              <Card
                key={config.id}
                className="p-5 bg-transparent border-border shadow-2xs space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-xs text-foreground">
                      {config.name}
                    </h4>
                  </div>
                  {config.isActive ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground border-border"
                    >
                      Inactive
                    </Badge>
                  )}
                </div>

                <div className="text-xs space-y-1 font-mono text-muted-foreground">
                  <p>Provider: {config.providerType}</p>
                  <p>Bucket: {config.bucket}</p>
                  {config.endpoint && (
                    <p className="truncate">Endpoint: {config.endpoint}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  {!config.isActive && (
                    <Button
                      size="sm"
                      onClick={() => activateMutation.mutate(config.id)}
                      className="h-7 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground flex-1"
                    >
                      Set Active
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(config.id)}
                    className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Add Storage Configuration Card */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          ADD S3 STORAGE PROVIDER
        </h3>
        <Card className="p-6 bg-transparent border-border shadow-2xs space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Configuration Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Provider Preset
                </label>
                <select
                  value={providerType}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full h-8 text-xs bg-card border border-border rounded-md px-2 text-foreground font-medium"
                >
                  <option value="minio">MinIO (Local/Self-Hosted)</option>
                  <option value="aws-s3">Amazon S3</option>
                  <option value="cloudflare-r2">Cloudflare R2</option>
                  <option value="digitalocean-spaces">
                    DigitalOcean Spaces
                  </option>
                  <option value="wasabi">Wasabi Hot Cloud Storage</option>
                  <option value="backblaze-b2">Backblaze B2</option>
                  <option value="hetzner">Hetzner Storage</option>
                  <option value="custom">Custom S3 Compatible</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Bucket Name
                </label>
                <Input
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                  required
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Region
                </label>
                <Input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  required
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-foreground">
                  Endpoint URL (Required for R2, MinIO, Spaces)
                </label>
                <Input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="http://127.0.0.1:9000"
                  className="h-8 text-xs font-mono bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Access Key ID
                </label>
                <Input
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  required
                  type="password"
                  className="h-8 text-xs font-mono bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Secret Access Key
                </label>
                <Input
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                  required
                  type="password"
                  className="h-8 text-xs font-mono bg-card border-border"
                />
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${testResult.success ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"}`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {testResult.message}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing}
                onClick={handleTestConnection}
                className="h-8 text-xs font-semibold border-border bg-card hover:bg-accent text-foreground gap-1.5"
              >
                <Plug className="h-3.5 w-3.5" />{" "}
                {testing ? "Testing..." : "Test S3 Connection"}
              </Button>

              <Button
                type="submit"
                size="sm"
                className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Save Configuration
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
};
