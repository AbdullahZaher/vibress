import React, { useEffect, useState, useCallback } from 'react';
import {
  ApiThemeSummary,
  ApiActiveTheme,
  listThemesApi,
  getActiveThemeApi,
  activateThemeApi,
  updateThemeSettingsApi,
  createThemePreviewApi,
} from '../lib/api';

import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Palette, CheckCircle2, Eye, Sparkles } from 'lucide-react';

export const ThemesSettings: React.FC = () => {
  const [themes, setThemes] = useState<ApiThemeSummary[]>([]);
  const [active, setActive] = useState<ApiActiveTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, unknown>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [themesRes, activeRes] = await Promise.all([
        listThemesApi(),
        getActiveThemeApi(),
      ]);
      setThemes(themesRes.themes || []);
      const activeTheme: ApiActiveTheme = {
        themeId: activeRes.themeId,
        themeVersion: activeRes.themeVersion,
        settings: activeRes.settings,
        settingsSchemaVersion: activeRes.settingsSchemaVersion,
      };
      setActive(activeTheme);
      setSettingsDraft(activeTheme.settings || {});
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || 'Failed to load themes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleActivate = async (id: string) => {
    setActivating(id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await activateThemeApi(id);
      setActive(res.theme);
      setSettingsDraft(res.theme.settings || {});
      setSuccessMsg(`Theme "${id}" activated.`);
      await load();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || 'Failed to activate theme');
    } finally {
      setActivating(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!active) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await updateThemeSettingsApi(active.themeId, settingsDraft);
      setActive(res.theme);
      setSettingsDraft(res.theme.settings || {});
      setSuccessMsg('Theme settings saved.');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || 'Failed to save theme settings');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async (themeId: string) => {
    try {
      const res = await createThemePreviewApi(themeId);
      setSuccessMsg(`Theme preview token created: ${res.previewToken}`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErrorMsg(e.message || 'Failed to open preview');
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Loading theme engine...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Theme & Design Settings</h1>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          {successMsg}
        </div>
      )}

      {/* Installed Themes Grid */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">INSTALLED THEMES</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {themes.map((t) => {
            const isActive = active?.themeId === t.manifest.id;
            return (
              <Card key={t.manifest.id} className="p-5 bg-transparent border-border shadow-2xs flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                      <Palette className="h-4 w-4 text-primary" /> {t.manifest.name}
                    </h4>
                    {isActive ? (
                      <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </Badge>
                    ) : (
                      <span className="text-[11px] font-mono text-muted-foreground">v{t.manifest.version}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.manifest.description || 'No description provided.'}</p>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  {!isActive && (
                    <Button
                      size="sm"
                      disabled={activating === t.manifest.id}
                      onClick={() => handleActivate(t.manifest.id)}
                      className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground flex-1"
                    >
                      {activating === t.manifest.id ? 'Activating...' : 'Activate Theme'}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePreview(t.manifest.id)}
                    className="h-8 text-xs border-border bg-card hover:bg-accent text-foreground gap-1"
                  >
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Active Theme Customization Form */}
      {active && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">ACTIVE THEME CUSTOMIZATION</h3>
          <Card className="p-5 bg-transparent border-border shadow-2xs space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm text-foreground">Design Options & Variables</h4>
                <p className="text-xs text-muted-foreground">Configure custom accent colors, typography, and layout settings.</p>
              </div>
              <Button
                size="sm"
                disabled={saving}
                onClick={handleSaveSettings}
                className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.entries(settingsDraft).map(([key, val]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-foreground capitalize">{key.replace(/_/g, ' ')}</label>
                  <Input
                    value={String(val ?? '')}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, [key]: e.target.value })}
                    className="h-8 text-xs bg-card border-border font-mono"
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
