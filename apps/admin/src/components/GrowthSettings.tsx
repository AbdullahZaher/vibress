import React, { useState } from 'react';
import { Mail, TrendingUp, MessageSquare, Sparkles } from 'lucide-react';
import { NewslettersSettings } from './NewslettersSettings';
import { IntelligenceSettings } from './IntelligenceSettings';
import { CommunitySettings } from './CommunitySettings';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

interface GrowthSettingsProps {
  initialTab?: 'newsletters' | 'intelligence' | 'community';
}

export const GrowthSettings: React.FC<GrowthSettingsProps> = ({ initialTab = 'newsletters' }) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header with Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Sparkles className="h-6 w-6 text-primary" />
            Growth & Audience
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Grow your audience with email newsletters, predictive intelligence, and member community engagement.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
          <TabsList className="bg-muted/80 p-1">
            <TabsTrigger value="newsletters" className="gap-2 text-xs">
              <Mail className="h-3.5 w-3.5" />
              Newsletters & Email
            </TabsTrigger>
            <TabsTrigger value="intelligence" className="gap-2 text-xs">
              <TrendingUp className="h-3.5 w-3.5" />
              Intelligence & Traffic
            </TabsTrigger>
            <TabsTrigger value="community" className="gap-2 text-xs">
              <MessageSquare className="h-3.5 w-3.5" />
              Community & Comments
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tabs Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="newsletters" className="mt-0">
          <NewslettersSettings />
        </TabsContent>

        <TabsContent value="intelligence" className="mt-0">
          <IntelligenceSettings />
        </TabsContent>

        <TabsContent value="community" className="mt-0">
          <CommunitySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};
