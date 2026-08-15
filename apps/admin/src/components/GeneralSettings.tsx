import React, { useEffect, useState } from "react";
import { getStaffSettingsApi, updateSettingApi } from "../lib/api/operations";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Sliders,
  Globe,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from "lucide-react";

export const GeneralSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState("Vibress");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [locale, setLocale] = useState("en");
  const [defaultPostStatus, setDefaultPostStatus] = useState("draft");
  const [postsPerPage, setPostsPerPage] = useState(10);

  const loadSettings = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await getStaffSettingsApi();
      for (const ns of res.namespaces) {
        if (ns.namespace === "site") {
          for (const s of ns.settings) {
            if (s.key === "title") setTitle(String(s.value ?? "Vibress"));
            if (s.key === "tagline") setTagline(String(s.value ?? ""));
            if (s.key === "description") setDescription(String(s.value ?? ""));
            if (s.key === "locale") setLocale(String(s.value ?? "en"));
          }
        }
        if (ns.namespace === "publishing") {
          for (const s of ns.settings) {
            if (s.key === "defaultPostStatus")
              setDefaultPostStatus(String(s.value ?? "draft"));
            if (s.key === "postsPerPage")
              setPostsPerPage(Number(s.value ?? 10));
          }
        }
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to load general settings",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await Promise.all([
        updateSettingApi("site", "title", title),
        updateSettingApi("site", "tagline", tagline),
        updateSettingApi("site", "description", description),
        updateSettingApi("site", "locale", locale),
        updateSettingApi("publishing", "defaultPostStatus", defaultPostStatus),
        updateSettingApi("publishing", "postsPerPage", Number(postsPerPage)),
      ]);
      setSuccessMsg("General settings saved successfully.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to save general settings",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin mr-2" />
        <span>Loading general settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Sliders className="h-6 w-6 text-primary" />
            General Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure basic publication details, language, locale, and content
            defaults.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2 shrink-0 cursor-pointer"
        >
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-sm animate-in fade-in duration-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3.5 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl text-sm animate-in fade-in duration-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Publication Identity */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Publication Info
            </CardTitle>
            <CardDescription>
              Basic identity information displayed across your site, feeds, and
              search engines.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="site-title"
                className="text-xs font-semibold text-foreground"
              >
                Publication Title
              </label>
              <Input
                id="site-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Vibress"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                The primary name of your publication or brand.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="site-tagline"
                className="text-xs font-semibold text-foreground"
              >
                Site Tagline
              </label>
              <Input
                id="site-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Thoughts, stories and ideas"
              />
              <p className="text-[11px] text-muted-foreground">
                A short memorable subtitle for your publication.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="site-desc"
                className="text-xs font-semibold text-foreground"
              >
                Site Description
              </label>
              <textarea
                id="site-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Describe your publication in a few sentences..."
              />
              <p className="text-[11px] text-muted-foreground">
                Used for SEO meta descriptions and social sharing cards.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="site-locale"
                className="text-xs font-semibold text-foreground"
              >
                Site Language / Locale
              </label>
              <Input
                id="site-locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                placeholder="e.g. en, ar, fr, es, de"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                IETF language code (e.g. `en` for English, `ar` for Arabic).
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Content & Publishing Defaults */}
        <Card className="border-border/60 bg-card shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Publishing Defaults
            </CardTitle>
            <CardDescription>
              Configure default workflows and pagination for newly created posts
              and pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="default-status"
                  className="text-xs font-semibold text-foreground"
                >
                  Default Post Status
                </label>
                <select
                  id="default-status"
                  value={defaultPostStatus}
                  onChange={(e) => setDefaultPostStatus(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="draft">Draft (Recommended)</option>
                  <option value="published">Published</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Initial status assigned when drafting new articles.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="posts-per-page"
                  className="text-xs font-semibold text-foreground"
                >
                  Posts Per Page
                </label>
                <Input
                  id="posts-per-page"
                  type="number"
                  min={1}
                  max={100}
                  value={postsPerPage}
                  onChange={(e) =>
                    setPostsPerPage(parseInt(e.target.value, 10) || 10)
                  }
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Number of posts displayed per pagination page on index views.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bottom Save Bar */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="submit"
            disabled={saving}
            className="gap-2 cursor-pointer"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
};
