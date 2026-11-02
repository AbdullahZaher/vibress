import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Menu, Plus, Trash2, X } from "lucide-react";
import { NavItem } from "../hooks/useSiteSettings";
import { useAdminLocale } from "../../../lib/admin-locale";

interface NavigationManagerCardProps {
  primaryNav: NavItem[];
  secondaryNav: NavItem[];
  onChangePrimary: (items: NavItem[]) => void;
  onChangeSecondary: (items: NavItem[]) => void;
  isHighlighted?: boolean | undefined;
}

export const NavigationManagerCard: React.FC<NavigationManagerCardProps> = ({
  primaryNav,
  secondaryNav,
  onChangePrimary,
  onChangeSecondary,
  isHighlighted,
}) => {
  const { tr } = useAdminLocale();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleAddPrimary = () => {
    onChangePrimary([
      ...primaryNav,
      { id: Date.now().toString(), label: "New Link", url: "/" },
    ]);
  };

  const handleRemovePrimary = (id: string) => {
    onChangePrimary(primaryNav.filter((n) => n.id !== id));
  };

  const handleUpdatePrimary = (
    id: string,
    key: "label" | "url",
    val: string,
  ) => {
    onChangePrimary(
      primaryNav.map((n) => (n.id === id ? { ...n, [key]: val } : n)),
    );
  };

  const handleAddSecondary = () => {
    onChangeSecondary([
      ...secondaryNav,
      { id: Date.now().toString(), label: "Footer Link", url: "/" },
    ]);
  };

  const handleRemoveSecondary = (id: string) => {
    onChangeSecondary(secondaryNav.filter((n) => n.id !== id));
  };

  const handleUpdateSecondary = (
    id: string,
    key: "label" | "url",
    val: string,
  ) => {
    onChangeSecondary(
      secondaryNav.map((n) => (n.id === id ? { ...n, [key]: val } : n)),
    );
  };

  return (
    <>
      <SettingsCard id="site-navigation" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Menu className="h-4 w-4" />}
          title="Navigation menus"
          description="Customize the header navigation bar and footer links displayed on your publication."
          currentValue={
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-xs font-mono">
                {primaryNav.length} Header
              </Badge>
              <span className="text-muted-foreground">•</span>
              <Badge variant="secondary" className="text-xs font-mono">
                {secondaryNav.length} Footer
              </Badge>
            </div>
          }
          actionLabel={tr("Manage navigation")}
          onAction={() => setIsDrawerOpen(true)}
        />
      </SettingsCard>

      {/* Navigation Editor Drawer */}
      <SettingsModalPortal
        title="Navigation menus"
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        <div className="fixed inset-0 z-50 flex justify-end rtl:justify-start bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-card border-s border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right rtl:slide-in-from-left duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Menu className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  {tr("Navigation menus")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                aria-label={tr("Close editor")}
                className="inline-flex size-11 items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Primary Header Links */}
              <div className="space-y-3">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">
                      {tr("Primary Navigation (Header)")}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {tr("Displayed in the main top navigation menu.")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddPrimary}
                    className="min-h-10 text-sm gap-1"
                  >
                    <Plus className="h-3 w-3" /> {tr("Add Link")}
                  </Button>
                </div>

                <div className="space-y-2">
                  {primaryNav.map((item, index) => (
                    <div key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                      <span className="w-4 shrink-0 text-center text-xs text-muted-foreground" aria-hidden="true">{index + 1}</span>
                      <Input
                        aria-label={`${tr("Header link")} ${index + 1} ${tr("Label")}`}
                        value={item.label}
                        onChange={(e) =>
                          handleUpdatePrimary(item.id, "label", e.target.value)
                        }
                        placeholder={tr("Label")}
                        className="text-sm min-h-10 flex-1"
                      />
                      <Input
                        aria-label={`${tr("Header link")} ${index + 1} URL`}
                        value={item.url}
                        onChange={(e) =>
                          handleUpdatePrimary(item.id, "url", e.target.value)
                        }
                        placeholder="/url"
                        className="text-sm min-h-10 flex-1 font-mono"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${tr("Remove")} ${tr("Header link")} ${index + 1}`}
                        onClick={() => handleRemovePrimary(item.id)}
                        className="min-h-11 min-w-11 px-3 text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Secondary Footer Links */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">
                      {tr("Secondary Navigation (Footer)")}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {tr("Displayed in the publication footer section.")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddSecondary}
                    className="min-h-10 text-sm gap-1"
                  >
                    <Plus className="h-3 w-3" /> {tr("Add Link")}
                  </Button>
                </div>

                <div className="space-y-2">
                  {secondaryNav.map((item, index) => (
                    <div key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                      <span className="w-4 shrink-0 text-center text-xs text-muted-foreground" aria-hidden="true">{index + 1}</span>
                      <Input
                        aria-label={`${tr("Footer link")} ${index + 1} ${tr("Label")}`}
                        value={item.label}
                        onChange={(e) =>
                          handleUpdateSecondary(
                            item.id,
                            "label",
                            e.target.value,
                          )
                        }
                        placeholder={tr("Label")}
                        className="text-sm min-h-10 flex-1"
                      />
                      <Input
                        aria-label={`${tr("Footer link")} ${index + 1} URL`}
                        value={item.url}
                        onChange={(e) =>
                          handleUpdateSecondary(item.id, "url", e.target.value)
                        }
                        placeholder="/url"
                        className="text-sm min-h-10 flex-1 font-mono"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${tr("Remove")} ${tr("Footer link")} ${index + 1}`}
                        onClick={() => handleRemoveSecondary(item.id)}
                        className="min-h-11 min-w-11 px-3 text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border/60 bg-muted/20">
              <p className="text-xs text-muted-foreground">{tr("Changes are saved using the main Save changes bar.")}</p>
              <Button
                size="sm"
                onClick={() => setIsDrawerOpen(false)}
                className="min-h-10 text-sm"
              >
                {tr("Close editor")}
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
