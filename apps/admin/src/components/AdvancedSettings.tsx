import React, { useState } from "react";
import { Cpu, Server, Activity } from "lucide-react";
import { PlatformSettings } from "./PlatformSettings";
import { OperationsSettings } from "./OperationsSettings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

interface AdvancedSettingsProps {
  initialTab?: "platform" | "operations";
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  initialTab = "platform",
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header with Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Cpu className="h-6 w-6 text-primary" />
            Advanced Platform & Operations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage developer APIs, webhooks, extensible plugins, system
            diagnostics, maintenance, and audit trails.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
          <TabsList className="bg-muted/80 p-1">
            <TabsTrigger value="platform" className="gap-2 text-xs">
              <Server className="h-3.5 w-3.5" />
              API & Integrations
            </TabsTrigger>
            <TabsTrigger value="operations" className="gap-2 text-xs">
              <Activity className="h-3.5 w-3.5" />
              System Operations
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tabs Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="platform" className="mt-0">
          <PlatformSettings />
        </TabsContent>

        <TabsContent value="operations" className="mt-0">
          <OperationsSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};
