import React from "react";
import { SettingsSearch } from "./SettingsSearch";
import { Sliders, Layout, CreditCard, Sparkles, Cpu } from "lucide-react";
import { PillarId } from "./settings.registry";

export interface PillarNavOption {
  id: PillarId;
  title: string;
  iconName: string;
}

interface SettingsNavigationProps {
  pillars: PillarNavOption[];
  activeSection: string;
  onSelectSection: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  resultCount?: number | undefined;
  totalCount?: number | undefined;
}

const getIcon = (iconName: string) => {
  switch (iconName) {
    case "Sliders":
      return <Sliders className="h-3.5 w-3.5" />;
    case "Layout":
      return <Layout className="h-3.5 w-3.5" />;
    case "CreditCard":
      return <CreditCard className="h-3.5 w-3.5" />;
    case "Sparkles":
      return <Sparkles className="h-3.5 w-3.5" />;
    case "Cpu":
      return <Cpu className="h-3.5 w-3.5" />;
    default:
      return <Sliders className="h-3.5 w-3.5" />;
  }
};

export const SettingsNavigation: React.FC<SettingsNavigationProps> = ({
  pillars,
  activeSection,
  onSelectSection,
  searchQuery,
  onSearchChange,
  resultCount,
  totalCount,
}) => {
  return (
    <nav
      role="navigation"
      aria-label="Settings categories navigation"
      className="sticky top-0 z-30 bg-background/90 backdrop-blur-md border-b border-border/60 pb-3 pt-1 -mt-2 space-y-3"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Navigation Tabs / Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {pillars.map((pillar) => {
            const isActive = activeSection === pillar.id && !searchQuery;
            return (
              <button
                key={pillar.id}
                type="button"
                onClick={() => onSelectSection(pillar.id)}
                aria-current={isActive ? "true" : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                {getIcon(pillar.iconName)}
                <span>{pillar.title}</span>
              </button>
            );
          })}
        </div>

        {/* Live Filter Search Component */}
        <SettingsSearch
          query={searchQuery}
          onQueryChange={onSearchChange}
          resultCount={resultCount}
          totalCount={totalCount}
        />
      </div>
    </nav>
  );
};
