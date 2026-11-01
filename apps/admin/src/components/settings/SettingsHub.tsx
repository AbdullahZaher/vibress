import React, { useEffect, useState } from "react";
import { useAdminLocale } from "../../lib/admin-locale";
import { useSettingsHub } from "./hooks/useSettingsHub";
import { useSettingsSearch } from "./hooks/useSettingsSearch";
import { SETTINGS_REGISTRY } from "./settings.registry";
import { SettingsSection } from "./SettingsSection";
import { SettingsCard } from "./SettingsCard";
import { SettingsCardRow } from "./SettingsCardRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { SettingsPermissionGate } from "./SettingsPermissionGate";
import { AdminPageHeader } from "../common/AdminPageHeader";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";
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
import { SocialLinksCard } from "./site/SocialLinksCard";
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
  Search,
  X,
  Database,
} from "lucide-react";

interface SettingsHubProps {
  initialSection?: string | undefined;
  can?: ((perm: string) => boolean) | undefined;
  onNavigate?: ((path: string) => void) | undefined;
}

const SECTION_IDS = SETTINGS_REGISTRY.map((p) => p.id);
const SETTINGS_CARD_PERMISSIONS: Record<string, string> = {
  "publication-info": "settings.manage", localization: "settings.manage",
  "metadata-social": "settings.manage", "site-privacy": "settings.manage",
  "staff-overview": "users.read", "design-branding": "settings.manage",
  "navigation-manager": "settings.manage", "social-links": "settings.manage",
  "themes-manager": "themes.manage", "announcement-bar": "settings.manage",
  "portal-access": "members.manage", "subscription-tiers": "billing.manage",
  "offers-promotions": "offers.manage", "newsletters-config": "email.manage",
  "analytics-tracking": "analytics.read", "community-discussions": "comments.manage",
  "recommendations-card": "recommendations.manage", "content-models": "posts.read",
  "code-injection": "settings.manage", "integrations-platform": "integrations.manage",
  "system-diagnostics": "system.read", "import-export": "imports.manage",
  "audit-logs": "audit.read", "danger-zone": "system.manage",
};


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
  onNavigate,
}) => {
  const { tr } = useAdminLocale();
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

  const { query, setQuery, filteredPillars, matchingCardsCount, highlightedCardId, highlightCard } =
    useSettingsSearch();

  // One category at a time; global search temporarily shows matching categories.
  const [activeSection, setActiveSection] = useState(() =>
    initialSection && SECTION_IDS.includes(initialSection) ? initialSection : "general",
  );

  useEffect(() => {
    if (initialSection && SECTION_IDS.includes(initialSection)) setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (!window.location.pathname.includes("localization")) return;
    setActiveSection("general");
    const timer = window.setTimeout(() => {
      document.getElementById("general-localization")?.scrollIntoView({ block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  const selectPillar = (id: string) => {
    setQuery("");
    setActiveSection(id);
    window.history.replaceState(null, "", `/admin/settings/${id}`);
  };

  const jumpToCard = (pillarId: string, cardId: string, anchor: string) => {
    selectPillar(pillarId);
    window.setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightCard(cardId);
    }, 0);
  };

  const isCardVisible = (cardId: string) => {
    return filteredPillars.some((p) => p.cards.some((c) => c.id === cardId));
  };

  const isPillarVisible = (pillarId: string) => {
    return filteredPillars.some((p) => p.id === pillarId) && (query.trim().length > 0 || activeSection === pillarId);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-12 w-full bg-card/60 rounded-xl border border-border/60" />
        <div className="space-y-4">
          <div className="h-6 w-40 bg-muted rounded" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-44 bg-card/60 rounded-xl border border-border/60" />
            <div className="h-44 bg-card/60 rounded-xl border border-border/60" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 pb-28">
      {/* Page Header */}
      <AdminPageHeader
        title={tr("Settings")}
        description={tr("Manage publication preferences, membership, theme, and system options.")}
      />

      {/* Search and Section Sticky Filter Bar */}
      <div className="sticky top-0 z-30 flex flex-col items-stretch justify-between gap-3 border-b border-border bg-card/95 py-3 backdrop-blur-md sm:flex-row sm:items-center">
        {/* Semantic section links, preserving existing /admin/settings/:section routes. */}
        <nav aria-label={tr("Mobile settings sections")} className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 lg:hidden">
          {SETTINGS_REGISTRY.filter((pillar) => !query.trim() || filteredPillars.some((match) => match.id === pillar.id)).map((pillar) => {
            const isActive = activeSection === pillar.id;
            return (
              <a
                key={pillar.id}
                href={`/admin/settings/${pillar.id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  selectPillar(pillar.id);
                }}
                className={cn(buttonVariants({ variant: isActive ? "subtle" : "ghost", size: "sm" }), "min-h-11 shrink-0 px-3.5")}
              >
                {getPillarIcon(pillar.iconName)}
                <span>{tr(pillar.title)}</span>
              </a>
            );
          })}
        </nav>

        {/* Search Input */}
        <div className="relative w-full sm:ms-auto sm:w-80">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            aria-label={tr("Search settings")}
            aria-controls="settings-results"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Filter settings...")}
            className="min-h-11 border-border bg-card ps-9 pe-12 text-sm"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setQuery("")}
              aria-label={tr("Clear search")}
              className="absolute end-1 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <aside className="hidden lg:sticky lg:top-24 lg:block" aria-label={tr("Settings categories")}>
          <nav aria-label={tr("Settings sections")} className="rounded-xl border border-border/70 bg-card p-2">
            {SETTINGS_REGISTRY.map((pillar) => {
              const selected = activeSection === pillar.id && !query.trim();
              return (
                <div key={pillar.id}>
                  <a href={`/admin/settings/${pillar.id}`}
                    aria-current={selected ? "location" : undefined}
                    onClick={(event) => { event.preventDefault(); selectPillar(pillar.id); }}
                    className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                  >
                    {getPillarIcon(pillar.iconName)}
                    <span className="flex-1">{tr(pillar.title)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{pillar.cards.filter((card) => !can || can(SETTINGS_CARD_PERMISSIONS[card.id] ?? "settings.manage")).length}</span>
                  </a>
                  {selected && (
                    <div className="mb-2 ms-6 border-s border-border/60 ps-3">
                      {pillar.cards.filter((card) => !can || can(SETTINGS_CARD_PERMISSIONS[card.id] ?? "settings.manage")).map((card) => (
                        <button key={card.id} type="button"
                          onClick={() => jumpToCard(pillar.id, card.id, card.anchor)}
                          className="block w-full rounded-md px-2 py-2 text-start text-xs leading-5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >{tr(card.title)}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
        <div id="settings-results" className="min-w-0 space-y-8">
          {query.trim() && (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {matchingCardsCount} {tr("matching settings")}
            </p>
          )}
          {query.trim() && matchingCardsCount === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Search className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" />
              <h2 className="font-semibold text-foreground">{tr("No matching settings")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{tr("Try another keyword or clear your search.")}</p>
              <Button variant="outline" className="mt-5" onClick={() => setQuery("")}>{tr("Clear search")}</Button>
            </div>
          )}
      {/* ========================================================================= */}
      {/* 1. GENERAL SETTINGS PILLAR                                                */}
      {/* ========================================================================= */}
      {isPillarVisible("general") && (
        <SettingsSection
          id="general"
          title={tr("General settings")}
          description={tr("Publication identity, localization, social metadata, and team permissions.")}
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
                onSaved={(primaryLocale) => general.syncSavedLocale(primaryLocale)}
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
          title={tr("Site")}
          description={tr("Visual presentation, theme selection, navigation menus, and public announcement banners.")}
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

          {isCardVisible("social-links") && (
            <SettingsPermissionGate permission="settings.manage" can={can}>
              <SocialLinksCard
                links={site.settings.socialLinks ?? []}
                onChange={(links) => site.updateField("socialLinks", links)}
                isHighlighted={highlightedCardId === "social-links"}
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
          title={tr("Membership")}
          description={tr("Reader subscriptions, member access levels, Stripe Connect payments, and promotional offers.")}
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
          title={tr("Growth")}
          description={tr("Audience acquisition, email newsletter delivery, privacy-first analytics, and member discussions.")}
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
          title={tr("Advanced")}
          description={tr("Code injection, developer APIs & webhooks, system maintenance, data import/export, and audit logs.")}
          icon={getPillarIcon("Cpu")}
        >
          {isCardVisible("content-models") && (
            <SettingsPermissionGate permission="posts.read" can={can}>
              <SettingsCard id="advanced-content-models" isHighlighted={highlightedCardId === "content-models"}>
                <SettingsCardRow
                  icon={<Database className="h-4 w-4" />}
                  title={tr("Content Models")}
                  description={tr("Define structured content types, fields, relations and their validation rules.")}
                  actionLabel="Manage models"
                  onAction={() => onNavigate?.("/admin/settings/advanced/content-models")}
                  disabled={!onNavigate}
                />
              </SettingsCard>
            </SettingsPermissionGate>
          )}

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

        </div>
      </div>

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
