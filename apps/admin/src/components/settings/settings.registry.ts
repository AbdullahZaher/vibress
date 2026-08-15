export type EditorMode = "inline" | "drawer" | "modal";

export type PillarId =
  "general" | "site" | "membership" | "growth" | "advanced";

export interface SettingCardMeta {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  pillarId: PillarId;
  anchor: string;
  editorMode: EditorMode;
  requiredPermission?: string;
  iconName: string;
  isLazy?: boolean;
}

export interface SettingPillarMeta {
  id: PillarId;
  title: string;
  description: string;
  iconName: string;
  anchor: string;
  requiredPermission?: string;
  cards: SettingCardMeta[];
}

export const SETTINGS_REGISTRY: SettingPillarMeta[] = [
  {
    id: "general",
    title: "General settings",
    description:
      "Publication identity, localization, social metadata, and team permissions.",
    iconName: "Sliders",
    anchor: "general",
    requiredPermission: "settings.general.manage",
    cards: [
      {
        id: "publication-info",
        title: "Title & description",
        description:
          "The details used to identify your publication around the web and in search results.",
        keywords: [
          "title",
          "description",
          "name",
          "tagline",
          "brand",
          "site name",
        ],
        pillarId: "general",
        anchor: "general-info",
        editorMode: "inline",
        requiredPermission: "settings.general.manage",
        iconName: "Globe",
      },
      {
        id: "localization",
        title: "Site timezone & language",
        description:
          "Set your publication language code and operational timezone for scheduled posts.",
        keywords: [
          "language",
          "locale",
          "timezone",
          "time",
          "date",
          "utc",
          "arabic",
          "english",
        ],
        pillarId: "general",
        anchor: "general-localization",
        editorMode: "inline",
        requiredPermission: "settings.general.manage",
        iconName: "Languages",
      },
      {
        id: "metadata-social",
        title: "Metadata & social cards",
        description:
          "Preview how your publication appears in Google search, X / Twitter, and Facebook.",
        keywords: [
          "seo",
          "meta",
          "social",
          "google",
          "twitter",
          "facebook",
          "opengraph",
          "search engine",
          "preview",
        ],
        pillarId: "general",
        anchor: "general-social",
        editorMode: "inline",
        requiredPermission: "settings.general.manage",
        iconName: "Share2",
      },
      {
        id: "site-privacy",
        title: "Make this site private",
        description:
          "Enable password protection to restrict access to your publication during staging or private launches.",
        keywords: [
          "private",
          "password",
          "protect",
          "lock",
          "staging",
          "access",
        ],
        pillarId: "general",
        anchor: "general-privacy",
        editorMode: "inline",
        requiredPermission: "settings.general.manage",
        iconName: "Lock",
      },
      {
        id: "staff-overview",
        title: "Staff & permissions",
        description:
          "Manage team members, authors, editors, and administrators with role-based access control.",
        keywords: [
          "staff",
          "users",
          "team",
          "authors",
          "editors",
          "permissions",
          "roles",
          "invite",
        ],
        pillarId: "general",
        anchor: "general-staff",
        editorMode: "modal",
        requiredPermission: "settings.general.manage",
        iconName: "Users",
      },
    ],
  },
  {
    id: "site",
    title: "Site",
    description:
      "Visual presentation, theme selection, navigation menus, and public announcement banners.",
    iconName: "Layout",
    anchor: "site",
    requiredPermission: "settings.site.manage",
    cards: [
      {
        id: "design-branding",
        title: "Design & branding",
        description:
          "Customize your publication accent colors, site icons, and cover imagery.",
        keywords: [
          "design",
          "branding",
          "color",
          "accent",
          "icon",
          "logo",
          "cover",
          "favicon",
          "theme style",
        ],
        pillarId: "site",
        anchor: "site-branding",
        editorMode: "inline",
        requiredPermission: "settings.site.manage",
        iconName: "Palette",
      },
      {
        id: "navigation-manager",
        title: "Navigation menus",
        description:
          "Customize the header navigation bar and footer links displayed on your publication.",
        keywords: [
          "navigation",
          "nav",
          "menu",
          "links",
          "header",
          "footer",
          "primary nav",
          "secondary nav",
        ],
        pillarId: "site",
        anchor: "site-navigation",
        editorMode: "drawer",
        requiredPermission: "settings.site.manage",
        iconName: "Menu",
      },
      {
        id: "themes-manager",
        title: "Themes",
        description:
          "Choose how your publication looks and feels with official and custom responsive themes.",
        keywords: [
          "themes",
          "templates",
          "molten",
          "default",
          "upload theme",
          "preview",
          "switch theme",
        ],
        pillarId: "site",
        anchor: "site-themes",
        editorMode: "drawer",
        requiredPermission: "settings.site.manage",
        iconName: "Palette",
        isLazy: true,
      },
      {
        id: "announcement-bar",
        title: "Announcement bar",
        description:
          "Highlight important news, product launches, or special announcements at the top of your site.",
        keywords: [
          "announcement",
          "banner",
          "top bar",
          "alert",
          "notice",
          "promotion",
        ],
        pillarId: "site",
        anchor: "site-announcement",
        editorMode: "inline",
        requiredPermission: "settings.site.manage",
        iconName: "Bell",
      },
    ],
  },
  {
    id: "membership",
    title: "Membership",
    description:
      "Reader subscriptions, member access levels, Stripe Connect payments, and promotional offers.",
    iconName: "CreditCard",
    anchor: "membership",
    requiredPermission: "settings.members.manage",
    cards: [
      {
        id: "portal-access",
        title: "Access & portal registration",
        description:
          "Configure how readers sign up, access member-only content, and manage session durations.",
        keywords: [
          "members",
          "signup",
          "portal",
          "register",
          "session",
          "ttl",
          "access",
          "login",
        ],
        pillarId: "membership",
        anchor: "membership-portal",
        editorMode: "inline",
        requiredPermission: "settings.members.manage",
        iconName: "UserCheck",
      },
      {
        id: "subscription-tiers",
        title: "Membership tiers & Stripe billing",
        description:
          "Set up subscription tiers and connect Stripe to accept recurring paid memberships.",
        keywords: [
          "tiers",
          "plans",
          "billing",
          "stripe",
          "paid",
          "subscriptions",
          "pricing",
          "currency",
          "money",
        ],
        pillarId: "membership",
        anchor: "membership-tiers",
        editorMode: "modal",
        requiredPermission: "settings.billing.manage",
        iconName: "CreditCard",
      },
      {
        id: "offers-promotions",
        title: "Offers & promotions",
        description:
          "Create discount codes and special introductory offers to accelerate member acquisition.",
        keywords: [
          "offers",
          "discounts",
          "coupons",
          "promotions",
          "sales",
          "trials",
        ],
        pillarId: "membership",
        anchor: "membership-offers",
        editorMode: "modal",
        requiredPermission: "settings.billing.manage",
        iconName: "Tag",
      },
    ],
  },
  {
    id: "growth",
    title: "Growth",
    description:
      "Audience acquisition, email newsletter delivery, privacy-first analytics, and member discussions.",
    iconName: "Sparkles",
    anchor: "growth",
    requiredPermission: "settings.growth.manage",
    cards: [
      {
        id: "newsletters-config",
        title: "Email newsletters & delivery",
        description:
          "Configure default email sender identity, SMTP delivery credentials, and newsletter branding.",
        keywords: [
          "newsletter",
          "email",
          "smtp",
          "mail",
          "sender",
          "mailpit",
          "delivery",
          "test email",
        ],
        pillarId: "growth",
        anchor: "growth-newsletters",
        editorMode: "drawer",
        requiredPermission: "settings.email.manage",
        iconName: "Mail",
      },
      {
        id: "analytics-tracking",
        title: "Analytics & tracking",
        description:
          "Connect Google Analytics 4, Plausible, or PostHog to measure visitor engagement.",
        keywords: [
          "analytics",
          "tracking",
          "google",
          "ga",
          "ga4",
          "plausible",
          "posthog",
          "stats",
          "visitors",
        ],
        pillarId: "growth",
        anchor: "growth-analytics",
        editorMode: "inline",
        requiredPermission: "settings.growth.manage",
        iconName: "BarChart3",
      },
      {
        id: "community-discussions",
        title: "Comments & moderation",
        description:
          "Enable reader discussions on published stories and set moderation filters.",
        keywords: [
          "comments",
          "discussions",
          "community",
          "moderation",
          "spam",
          "replies",
        ],
        pillarId: "growth",
        anchor: "growth-community",
        editorMode: "inline",
        requiredPermission: "settings.comments.manage",
        iconName: "MessageSquare",
      },
      {
        id: "recommendations-card",
        title: "Recommendations & blogroll",
        description:
          "Recommend other independent publications to your readers to exchange audience growth.",
        keywords: [
          "recommendations",
          "blogroll",
          "cross-promotion",
          "partners",
          "network",
        ],
        pillarId: "growth",
        anchor: "growth-recommendations",
        editorMode: "modal",
        requiredPermission: "settings.growth.manage",
        iconName: "Share2",
      },
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    description:
      "Code injection, developer APIs & webhooks, system maintenance, data import/export, and audit logs.",
    iconName: "Cpu",
    anchor: "advanced",
    requiredPermission: "settings.manage",
    cards: [
      {
        id: "code-injection",
        title: "Code injection",
        description:
          "Inject custom CSS styles, meta tags, and JavaScript trackers into the site header or footer.",
        keywords: [
          "code",
          "injection",
          "custom css",
          "javascript",
          "header code",
          "footer code",
          "script",
        ],
        pillarId: "advanced",
        anchor: "advanced-code",
        editorMode: "drawer",
        requiredPermission: "settings.manage",
        iconName: "Code2",
        isLazy: true,
      },
      {
        id: "integrations-platform",
        title: "Developer platform & integrations",
        description:
          "Manage API keys, outgoing webhooks, and third-party plugin extensions.",
        keywords: [
          "api",
          "keys",
          "webhooks",
          "plugins",
          "developer",
          "integrations",
          "zapier",
          "tokens",
        ],
        pillarId: "advanced",
        anchor: "advanced-integrations",
        editorMode: "drawer",
        requiredPermission: "integrations.manage",
        iconName: "Cpu",
        isLazy: true,
      },
      {
        id: "system-diagnostics",
        title: "System health & cache",
        description:
          "Monitor database and Redis health, and perform global cache invalidations.",
        keywords: [
          "diagnostics",
          "health",
          "cache",
          "redis",
          "database",
          "purge",
          "memory",
          "status",
        ],
        pillarId: "advanced",
        anchor: "advanced-diagnostics",
        editorMode: "inline",
        requiredPermission: "system.read",
        iconName: "Activity",
      },
      {
        id: "import-export",
        title: "Import / export content",
        description:
          "Back up your entire publication content or migrate from Ghost, WordPress, or Substack.",
        keywords: [
          "import",
          "export",
          "backup",
          "migrate",
          "ghost",
          "wordpress",
          "substack",
          "json",
        ],
        pillarId: "advanced",
        anchor: "advanced-import-export",
        editorMode: "modal",
        requiredPermission: "imports.manage",
        iconName: "FileJson",
      },
      {
        id: "audit-logs",
        title: "Audit & activity log",
        description:
          "Immutable security trail of administrative actions, logins, and setting modifications.",
        keywords: [
          "audit",
          "logs",
          "security",
          "history",
          "activity",
          "events",
          "compliance",
        ],
        pillarId: "advanced",
        anchor: "advanced-audit",
        editorMode: "drawer",
        requiredPermission: "audit.read",
        iconName: "History",
        isLazy: true,
      },
      {
        id: "danger-zone",
        title: "Danger zone",
        description:
          "Irreversible destructive actions such as deleting all content or resetting configurations.",
        keywords: [
          "danger",
          "delete",
          "reset",
          "destroy",
          "wipe",
          "all content",
        ],
        pillarId: "advanced",
        anchor: "advanced-danger",
        editorMode: "modal",
        requiredPermission: "system.manage",
        iconName: "AlertTriangle",
      },
    ],
  },
];
