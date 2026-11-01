import React from "react";
import { SettingsSearch } from "./SettingsSearch";
import { useAdminLocale } from "../../lib/admin-locale";
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
  const { tr } = useAdminLocale();
  return (
    <nav
      role="navigation"
      aria-label={tr("Settings categories navigation")}
      className="flex min-w-0 flex-col gap-3 border-b border-border/70 pb-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="contents">
        {/* Navigation Tabs / Pills */}
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto no-scrollbar">
          {pillars.map((pillar) => {
            const isActive = activeSection === pillar.id && !searchQuery;
            return (
              <button
                key={pillar.id}
                type="button"
                onClick={() => onSelectSection(pillar.id)}
                aria-current={isActive ? "location" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {getIcon(pillar.iconName)}
                <span>{tr(pillar.title)}</span>
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
