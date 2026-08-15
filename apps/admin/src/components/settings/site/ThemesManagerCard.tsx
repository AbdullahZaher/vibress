import React, { useState, useCallback } from 'react';
import {
  ApiThemeSummary,
  ApiActiveTheme,
  listThemesApi,
  getActiveThemeApi,
  activateThemeApi,
} from '../../../lib/api';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { SettingsModalPortal } from '../SettingsModalPortal';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Palette, CheckCircle2, Eye, RefreshCw, X } from 'lucide-react';

interface ThemesManagerCardProps {
  isHighlighted?: boolean | undefined;
}

export const ThemesManagerCard: React.FC<ThemesManagerCardProps> = ({ isHighlighted }) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [themes, setThemes] = useState<ApiThemeSummary[]>([]);
  const [active, setActive] = useState<ApiActiveTheme | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [themesRes, activeRes] = await Promise.all([
        listThemesApi(),
        getActiveThemeApi(),
      ]);
      setThemes(themesRes.themes || []);
      setActive({
        themeId: activeRes.themeId,
        themeVersion: activeRes.themeVersion,
        settings: activeRes.settings,
        settingsSchemaVersion: activeRes.settingsSchemaVersion,
      });
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = () => {
    setIsDrawerOpen(true);
    load();
  };

  const handleActivate = async (id: string) => {
    setActivating(id);
    try {
      const res = await activateThemeApi(id);
      setActive(res.theme);
      await load();
    } catch {
      // Error handled
    } finally {
      setActivating(null);
    }
  };

  return (
    <>
      <SettingsCard id="site-themes" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Palette className="h-4 w-4" />}
          title="Themes"
          description="Choose how your publication looks and feels with official and custom responsive themes."
          currentValue={
            <Badge variant="secondary" className="text-xs font-mono gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              {active ? active.themeId : 'Vibress Default'} (Active)
            </Badge>
          }
          actionLabel="Change theme"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Themes Manager Slide-over Drawer */}
      <SettingsModalPortal isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)}>
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Themes Manager</h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={load}
                  disabled={loading}
                  className="gap-1.5 text-xs cursor-pointer h-8"
                  title="Reload registry themes from backend"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
                <button
                  type="button"
                  aria-label="Close themes drawer"
                  onClick={() => setIsDrawerOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                    Official Theme Registry
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All official Vibress publication templates are installed and managed via the core theme registry. Custom themes can be added to your installation by registering them in the <code className="font-mono text-primary text-[11px]">@vibress/themes-registry</code> workspace package.
                </p>
              </div>

              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-xs">Loading theme catalog...</p>
                </div>
              ) : themes.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-xs">
                  No themes discovered in registry.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {themes.map((theme) => {
                    const isCurrent = active?.themeId === theme.manifest.id;
                    return (
                      <div
                        key={theme.manifest.id}
                        className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${
                          isCurrent
                            ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30 shadow-xs'
                            : 'border-border/70 hover:border-border hover:bg-muted/10'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-foreground">{theme.manifest.name}</h4>
                            <Badge variant="secondary" className="text-[10px] font-mono">
                              v{theme.manifest.version}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                            {theme.manifest.description || 'Responsive publishing theme optimized for modern publications.'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-4 border-t border-border/40 mt-4">
                          <Button
                            size="sm"
                            disabled={isCurrent || activating === theme.manifest.id}
                            onClick={() => handleActivate(theme.manifest.id)}
                            className="text-xs h-7 flex-1 cursor-pointer"
                            variant={isCurrent ? 'outline' : 'default'}
                          >
                            {isCurrent ? (
                              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                                <CheckCircle2 className="h-3 w-3" /> Active
                              </span>
                            ) : activating === theme.manifest.id ? (
                              <span className="flex items-center gap-1">
                                <RefreshCw className="h-3 w-3 animate-spin" /> Activating...
                              </span>
                            ) : (
                              'Activate'
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(`/?preview=${theme.manifest.id}`, '_blank')}
                            className="h-7 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Preview theme in new tab"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button size="sm" onClick={() => setIsDrawerOpen(false)} className="text-xs cursor-pointer">
                Done
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
