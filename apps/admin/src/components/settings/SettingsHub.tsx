import React, { useEffect } from "react";
import { useSettingsHub } from "./hooks/useSettingsHub";
import { useSettingsSearch } from "./hooks/useSettingsSearch";
import { useScrollSpy } from "./hooks/useScrollSpy";
import { SETTINGS_REGISTRY } from "./settings.registry";
import { SettingsSection } from "./SettingsSection";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { SettingsPermissionGate } from "./SettingsPermissionGate";
import { Input } from "../ui/input";

// General Pillar Compact Cards
import { PublicationInfoCard } from "./general/PublicationInfoCard";
import { LocalizationCard } from "./general/LocalizationCard";
import { MetadataSocialCard } from "./general/MetadataSocialCard";
import { SitePrivacyCard } from "./general/SitePrivacyCard";
import { StaffOverviewCard } from "./general/StaffOverviewCard";

// Site Pillar Compact Cards
import { DesignBrandingCard } from "./site/DesignBrandingCard";
import { NavigationManagerCard } from "./site/NavigationManagerCard";
import { ThemesManagerCard } from "./site/ThemesManagerCard";
import { AnnouncementBarCard } from "./site/AnnouncementBarCard";

// Membership Pillar Compact Cards
import { PortalAccessCard } from "./membership/PortalAccessCard";
import { SubscriptionTiersCard } from "./membership/SubscriptionTiersCard";
import { OffersPromotionsCard } from "./membership/OffersPromotionsCard";

// Growth Pillar Compact Cards
import { NewslettersConfigCard } from "./growth/NewslettersConfigCard";
import { AnalyticsTrackingCard } from "./growth/AnalyticsTrackingCard";
import { CommunityDiscussionsCard } from "./growth/CommunityDiscussionsCard";
import { RecommendationsCard } from "./growth/RecommendationsCard";

// Advanced Pillar Compact Cards
import { CodeInjectionCard } from "./advanced/CodeInjectionCard";
import { IntegrationsPlatformCard } from "./advanced/IntegrationsPlatformCard";
import { SystemDiagnosticsCard } from "./advanced/SystemDiagnosticsCard";
import { ImportExportCard } from "./advanced/ImportExportCard";
import { AuditLogsCard } from "./advanced/AuditLogsCard";
import { DangerZoneCard } from "./advanced/DangerZoneCard";

import {
  Sliders,
  Layout,
  CreditCard,
  Sparkles,
  Cpu,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

interface SettingsHubProps {
  initialSection?: string | undefined;
  can?: ((perm: string) => boolean) | undefined;
}

const SECTION_IDS = SETTINGS_REGISTRY.map((p) => p.id);

const getPillarIcon = (iconName: string) => {
  switch (iconName) {
    case "Sliders":
      return <Sliders className="h-4 w-4" />;
    case "Layout":
      return <Layout className="h-4 w-4" />;
    case "CreditCard":
      return <CreditCard className="h-4 w-4" />;
    case "Sparkles":
      return <Sparkles className="h-4 w-4" />;
    case "Cpu":
      return <Cpu className="h-4 w-4" />;
    default:
      return <Sliders className="h-4 w-4" />;
  }
};

export const SettingsHub: React.FC<SettingsHubProps> = ({
  initialSection,
  can,
}) => {
  const {
    general,
    site,
    membership,
    growth,
    advanced,
    loading,
    saving,
    isDirty,
    dirtyCount,
    globalSuccess,
    globalError,
    saveAllDirty,
    discardAllDirty,
  } = useSettingsHub();

  const { query, setQuery, filteredPillars, highlightedCardId } =
    useSettingsSearch();

  const { activeSection, scrollToSection } = useScrollSpy(SECTION_IDS, 120);

  // Jump to initial anchor on load or route change
  useEffect(() => {
    if (initialSection && SECTION_IDS.includes(initialSection as any)) {
      setTimeout(() => scrollToSection(initialSection, false), 50);
    }
  }, [initialSection, scrollToSection]);

  const isCardVisible = (cardId: string) => {
    return filteredPillars.some((p) => p.cards.some((c) => c.id === cardId));
  };

  const isPillarVisible = (pillarId: string) => {
    return filteredPillars.some((p) => p.id === pillarId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[450px]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          <span className="text-xs font-medium">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-28">
      {/* Search and Section Sticky Filter Bar */}
      <div className="sticky top-0 z-30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-xs">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          {SETTINGS_REGISTRY.map((pillar) => {
            const isActive = activeSection === pillar.id;
            return (
              <button
                key={pillar.id}
                type="button"
                onClick={() => scrollToSection(pillar.id, true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {getPillarIcon(pillar.iconName)}
                <span>{pillar.title}</span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter settings..."
            className="pl-8 text-xs h-8.5 bg-card border-border/80"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. GENERAL SETTINGS PILLAR                                                */}
      {/* ========================================================================= */}
      {isPillarVisible("general") && (
        <SettingsSection
          id="general"
          title="General settings"
          description="Publication identity, localization, social metadata, and team permissions."
          icon={getPillarIcon("Sliders")}
        >
          {isCardVisible("publication-info") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <PublicationInfoCard
                title={general.settings.title}
                tagline={general.settings.tagline}
                description={general.settings.description}
                onChange={(key, val) => general.updateField(key, val)}
                isHighlighted={highlightedCardId === "publication-info"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("localization") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <LocalizationCard
                locale={general.settings.locale}
                timezone={general.settings.timezone}
                onChange={(key, val) => general.updateField(key, val)}
                isHighlighted={highlightedCardId === "localization"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("metadata-social") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <MetadataSocialCard
                title={general.settings.title}
                description={general.settings.description}
                isHighlighted={highlightedCardId === "metadata-social"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("site-privacy") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <SitePrivacyCard
                isPrivate={general.settings.isPrivate}
                password={general.settings.password}
                onChange={(key, val) => general.updateField(key, val as any)}
                isHighlighted={highlightedCardId === "site-privacy"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("staff-overview") && (
            <SettingsPermissionGate permission="users.read" can={can}>
              <StaffOverviewCard
                isHighlighted={highlightedCardId === "staff-overview"}
              />
            </SettingsPermissionGate>
          )}
        </SettingsSection>
      )}

      {/* ========================================================================= */}
      {/* 2. SITE PILLAR                                                            */}
      {/* ========================================================================= */}
      {isPillarVisible("site") && (
        <SettingsSection
          id="site"
          title="Site"
          description="Visual presentation, theme selection, navigation menus, and public announcement banners."
          icon={getPillarIcon("Layout")}
        >
          {isCardVisible("design-branding") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <DesignBrandingCard
                accentColor={site.settings.accentColor}
                iconUrl={site.settings.iconUrl}
                logoUrl={site.settings.logoUrl}
                coverUrl={site.settings.coverUrl}
                onChange={(key, val) => site.updateField(key, val)}
                isHighlighted={highlightedCardId === "design-branding"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("navigation-manager") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <NavigationManagerCard
                primaryNav={site.settings.primaryNav}
                secondaryNav={site.settings.secondaryNav}
                onChangePrimary={(items) =>
                  site.updateField("primaryNav", items)
                }
                onChangeSecondary={(items) =>
                  site.updateField("secondaryNav", items)
                }
                isHighlighted={highlightedCardId === "navigation-manager"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("themes-manager") && (
            <SettingsPermissionGate permission="themes.manage" can={can}>
              <ThemesManagerCard
                isHighlighted={highlightedCardId === "themes-manager"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("announcement-bar") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <AnnouncementBarCard
                enabled={site.settings.announcementEnabled}
                text={site.settings.announcementText}
                url={site.settings.announcementUrl}
                onChange={(key, val) => site.updateField(key, val as any)}
                isHighlighted={highlightedCardId === "announcement-bar"}
              />
            </SettingsPermissionGate>
          )}
        </SettingsSection>
      )}

      {/* ========================================================================= */}
      {/* 3. MEMBERSHIP PILLAR                                                      */}
      {/* ========================================================================= */}
      {isPillarVisible("membership") && (
        <SettingsSection
          id="membership"
          title="Membership"
          description="Reader subscriptions, member access levels, Stripe Connect payments, and promotional offers."
          icon={getPillarIcon("CreditCard")}
        >
          {isCardVisible("portal-access") && (
            <SettingsPermissionGate permission="members.manage" can={can}>
              <PortalAccessCard
                signupEnabled={membership.settings.signupEnabled}
                defaultNewsletterOptIn={
                  membership.settings.defaultNewsletterOptIn
                }
                memberSessionTtlHours={
                  membership.settings.memberSessionTtlHours
                }
                onChange={(key, val) => membership.updateField(key, val as any)}
                isHighlighted={highlightedCardId === "portal-access"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("subscription-tiers") && (
            <SettingsPermissionGate permission="billing.manage" can={can}>
              <SubscriptionTiersCard
                currency={membership.settings.currency}
                isHighlighted={highlightedCardId === "subscription-tiers"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("offers-promotions") && (
            <SettingsPermissionGate permission="offers.manage" can={can}>
              <OffersPromotionsCard
                isHighlighted={highlightedCardId === "offers-promotions"}
              />
            </SettingsPermissionGate>
          )}
        </SettingsSection>
      )}

      {/* ========================================================================= */}
      {/* 4. GROWTH PILLAR                                                          */}
      {/* ========================================================================= */}
      {isPillarVisible("growth") && (
        <SettingsSection
          id="growth"
          title="Growth"
          description="Audience acquisition, email newsletter delivery, privacy-first analytics, and member discussions."
          icon={getPillarIcon("Sparkles")}
        >
          {isCardVisible("newsletters-config") && (
            <SettingsPermissionGate permission="email.manage" can={can}>
              <NewslettersConfigCard
                fromName={growth.settings.fromName}
                fromEmail={growth.settings.fromEmail}
                smtpHost={growth.settings.smtpHost}
                onChange={(key, val) => growth.updateField(key, val)}
                isHighlighted={highlightedCardId === "newsletters-config"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("analytics-tracking") && (
            <SettingsPermissionGate permission="analytics.read" can={can}>
              <AnalyticsTrackingCard
                gaId={growth.settings.gaId}
                plausibleDomain={growth.settings.plausibleDomain}
                posthogKey={growth.settings.posthogKey}
                onChange={(key, val) => growth.updateField(key, val)}
                isHighlighted={highlightedCardId === "analytics-tracking"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("community-discussions") && (
            <SettingsPermissionGate permission="comments.manage" can={can}>
              <CommunityDiscussionsCard
                commentAccess={growth.settings.commentAccess}
                preModeration={growth.settings.preModeration}
                onChange={(key, val) => growth.updateField(key, val as any)}
                isHighlighted={highlightedCardId === "community-discussions"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("recommendations-card") && (
            <SettingsPermissionGate
              permission="recommendations.manage"
              can={can}
            >
              <RecommendationsCard
                isHighlighted={highlightedCardId === "recommendations-card"}
              />
            </SettingsPermissionGate>
          )}
        </SettingsSection>
      )}

      {/* ========================================================================= */}
      {/* 5. ADVANCED PILLAR                                                        */}
      {/* ========================================================================= */}
      {isPillarVisible("advanced") && (
        <SettingsSection
          id="advanced"
          title="Advanced"
          description="Code injection, developer APIs & webhooks, system maintenance, data import/export, and audit logs."
          icon={getPillarIcon("Cpu")}
        >
          {isCardVisible("code-injection") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <CodeInjectionCard
                headerCode={advanced.settings.headerCode}
                footerCode={advanced.settings.footerCode}
                onChange={(key, val) => advanced.updateField(key, val)}
                isHighlighted={highlightedCardId === "code-injection"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("integrations-platform") && (
            <SettingsPermissionGate permission="integrations.manage" can={can}>
              <IntegrationsPlatformCard
                isHighlighted={highlightedCardId === "integrations-platform"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("system-diagnostics") && (
            <SettingsPermissionGate permission="system.read" can={can}>
              <SystemDiagnosticsCard
                isHighlighted={highlightedCardId === "system-diagnostics"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("import-export") && (
            <SettingsPermissionGate permission="imports.manage" can={can}>
              <ImportExportCard
                isHighlighted={highlightedCardId === "import-export"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("audit-logs") && (
            <SettingsPermissionGate permission="audit.read" can={can}>
              <AuditLogsCard
                isHighlighted={highlightedCardId === "audit-logs"}
              />
            </SettingsPermissionGate>
          )}

          {isCardVisible("danger-zone") && (
            <SettingsPermissionGate permission="system.manage" can={can}>
              <DangerZoneCard
                isHighlighted={highlightedCardId === "danger-zone"}
              />
            </SettingsPermissionGate>
          )}
        </SettingsSection>
      )}

      {/* Floating Save / Discard Action Bar */}
      <SettingsSaveBar
        isDirty={isDirty}
        dirtyCount={dirtyCount}
        saving={saving}
        onSave={saveAllDirty}
        onDiscard={discardAllDirty}
        successMsg={globalSuccess}
        errorMsg={globalError}
      />
    </div>
  );
};
