import React, { useState } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { SettingsModalPortal } from '../SettingsModalPortal';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Menu, Plus, Trash2, GripVertical, X } from 'lucide-react';
import { NavItem } from '../hooks/useSiteSettings';

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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleAddPrimary = () => {
    onChangePrimary([...primaryNav, { id: Date.now().toString(), label: 'New Link', url: '/' }]);
  };

  const handleRemovePrimary = (id: string) => {
    onChangePrimary(primaryNav.filter((n) => n.id !== id));
  };

  const handleUpdatePrimary = (id: string, key: 'label' | 'url', val: string) => {
    onChangePrimary(primaryNav.map((n) => (n.id === id ? { ...n, [key]: val } : n)));
  };

  const handleAddSecondary = () => {
    onChangeSecondary([...secondaryNav, { id: Date.now().toString(), label: 'Footer Link', url: '/' }]);
  };

  const handleRemoveSecondary = (id: string) => {
    onChangeSecondary(secondaryNav.filter((n) => n.id !== id));
  };

  const handleUpdateSecondary = (id: string, key: 'label' | 'url', val: string) => {
    onChangeSecondary(secondaryNav.map((n) => (n.id === id ? { ...n, [key]: val } : n)));
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
          actionLabel="Manage navigation"
          onAction={() => setIsDrawerOpen(true)}
        />
      </SettingsCard>

      {/* Navigation Editor Drawer */}
      <SettingsModalPortal isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)}>
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Menu className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Navigation Menus</h3>
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
              {/* Primary Header Links */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">Primary Navigation (Header)</h4>
                    <p className="text-[11px] text-muted-foreground">Displayed in the main top navigation menu.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddPrimary}
                    className="h-7 text-xs gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" /> Add Link
                  </Button>
                </div>

                <div className="space-y-2">
                  {primaryNav.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab shrink-0" />
                      <Input
                        value={item.label}
                        onChange={(e) => handleUpdatePrimary(item.id, 'label', e.target.value)}
                        placeholder="Label"
                        className="text-xs h-8 flex-1"
                      />
                      <Input
                        value={item.url}
                        onChange={(e) => handleUpdatePrimary(item.id, 'url', e.target.value)}
                        placeholder="/url"
                        className="text-xs h-8 flex-1 font-mono"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemovePrimary(item.id)}
                        className="h-8 px-2 text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Secondary Footer Links */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">Secondary Navigation (Footer)</h4>
                    <p className="text-[11px] text-muted-foreground">Displayed in the publication footer section.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddSecondary}
                    className="h-7 text-xs gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" /> Add Link
                  </Button>
                </div>

                <div className="space-y-2">
                  {secondaryNav.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab shrink-0" />
                      <Input
                        value={item.label}
                        onChange={(e) => handleUpdateSecondary(item.id, 'label', e.target.value)}
                        placeholder="Label"
                        className="text-xs h-8 flex-1"
                      />
                      <Input
                        value={item.url}
                        onChange={(e) => handleUpdateSecondary(item.id, 'url', e.target.value)}
                        placeholder="/url"
                        className="text-xs h-8 flex-1 font-mono"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveSecondary(item.id)}
                        className="h-8 px-2 text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button size="sm" onClick={() => setIsDrawerOpen(false)} className="text-xs cursor-pointer">
                Done Editing
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
