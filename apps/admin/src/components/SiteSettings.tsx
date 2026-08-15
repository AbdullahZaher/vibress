import React, { useState } from "react";
import { Palette, HardDrive, Layout } from "lucide-react";
import { ThemesSettings } from "./ThemesSettings";
import { StorageSettings } from "./StorageSettings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

interface SiteSettingsProps {
  initialTab?: "themes" | "storage";
}

export const SiteSettings: React.FC<SiteSettingsProps> = ({
  initialTab = "themes",
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Top Header with Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Layout className="h-6 w-6 text-primary" />
            Site Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your site's visual presentation, themes, branding, and asset
            storage providers.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
          <TabsList className="bg-muted/80 p-1">
            <TabsTrigger value="themes" className="gap-2 text-xs">
              <Palette className="h-3.5 w-3.5" />
              Themes & Design
            </TabsTrigger>
            <TabsTrigger value="storage" className="gap-2 text-xs">
              <HardDrive className="h-3.5 w-3.5" />
              Storage & Assets
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tabs Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="themes" className="mt-0">
          <ThemesSettings />
        </TabsContent>

        <TabsContent value="storage" className="mt-0">
          <StorageSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};
