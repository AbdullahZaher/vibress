import { ReactNode, Suspense, lazy } from "react";
import { ApiUser } from "./api";
import { RouteErrorBoundary } from "../components/common/RouteErrorBoundary";
import { PermissionDenied } from "../components/common/PermissionDenied";
import { RouteNotFound } from "../components/common/RouteNotFound";

// Lazy-loaded route chunks for optimized code splitting
const AnalyticsDashboard = lazy(() =>
  import("../components/layout/AnalyticsDashboard").then((m) => ({
    default: m.AnalyticsDashboard,
  })),
);
const PostsList = lazy(() =>
  import("../components/PostsList").then((m) => ({ default: m.PostsList })),
);
const PostEditor = lazy(() =>
  import("../components/PostEditor").then((m) => ({ default: m.PostEditor })),
);
const PagesList = lazy(() =>
  import("../components/PagesList").then((m) => ({ default: m.PagesList })),
);
const PageEditor = lazy(() =>
  import("../components/PageEditor").then((m) => ({ default: m.PageEditor })),
);
const TagsManager = lazy(() =>
  import("../components/TagsManager").then((m) => ({ default: m.TagsManager })),
);
const MediaLibrary = lazy(() =>
  import("../components/MediaLibrary").then((m) => ({
    default: m.MediaLibrary,
  })),
);
const MembersList = lazy(() =>
  import("../components/MembersList").then((m) => ({ default: m.MembersList })),
);
const SettingsHub = lazy(() =>
  import("../components/settings/SettingsHub").then((m) => ({
    default: m.SettingsHub,
  })),
);
const ContentModelList = lazy(() =>
  import("../components/models/ContentModelList").then((m) => ({
    default: m.ContentModelList,
  })),
);
const ContentModelEditor = lazy(() =>
  import("../components/models/ContentModelEditor").then((m) => ({
    default: m.ContentModelEditor,
  })),
);
const DynamicCollectionList = lazy(() =>
  import("../components/collections/DynamicCollectionList").then((m) => ({
    default: m.DynamicCollectionList,
  })),
);
const DynamicCollectionEntryEditor = lazy(() =>
  import("../components/collections/DynamicCollectionEntryEditor").then((m) => ({
    default: m.DynamicCollectionEntryEditor,
  })),
);
const VisualAutomationBuilder = lazy(() =>
  import("../components/automations/VisualAutomationBuilder").then((m) => ({
    default: m.VisualAutomationBuilder,
  })),
);

export interface RouteMatch {
  params: Record<string, string>;
  searchParams: URLSearchParams;
  pathname: string;
}

export interface AdminRouteDefinition {
  pattern: string;
  exact?: boolean;
  requiredPermission?: string;
  render: (ctx: {
    user: ApiUser;
    match: RouteMatch;
    onNavigate: (path: string) => void;
    can: (permissionKey: string) => boolean;
  }) => ReactNode;
}

/**
 * Route loading fallback skeleton
 */
const RouteLoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[300px] w-full text-muted-foreground gap-2">
    <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    <span className="text-sm">Loading view...</span>
  </div>
);

/**
 * Parses route pattern like "/admin/posts/:postId" and matches against pathname.
 */
export function matchRoutePattern(
  pattern: string,
  pathname: string,
  exact = false,
): { matches: boolean; params: Record<string, string> } {
  const normPath = pathname.replace(/\/+$/, "") || "/";
  const normPattern = pattern.replace(/\/+$/, "") || "/";

  const patternParts = normPattern.split("/");
  const pathParts = normPath.split("/");

  if (exact && patternParts.length !== pathParts.length) {
    return { matches: false, params: {} };
  }

  if (!exact && pathParts.length < patternParts.length) {
    return { matches: false, params: {} };
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pPart = patternParts[i];
    const actualPart = pathParts[i];

    if (pPart === undefined || actualPart === undefined) {
      return { matches: false, params: {} };
    }

    if (pPart.startsWith(":")) {
      const paramName = pPart.slice(1);
      params[paramName] = actualPart;
    } else if (pPart !== actualPart) {
      return { matches: false, params: {} };
    }
  }

  return { matches: true, params };
}

/**
 * Declarative route map for Vibress Admin with granular route boundaries.
 */
export const adminRoutes: AdminRouteDefinition[] = [
  // 1. Dashboard Root
  {
    pattern: "/admin",
    exact: true,
    render: ({ user }) => <AnalyticsDashboard user={user} />,
  },
  // 2. Posts Routes
  {
    pattern: "/admin/posts",
    exact: true,
    render: ({ onNavigate, can }) => (
      <PostsList onNavigate={onNavigate} canPublish={can("posts.publish")} />
    ),
  },
  {
    pattern: "/admin/posts/drafts",
    exact: true,
    render: ({ onNavigate, can }) => (
      <PostsList
        onNavigate={onNavigate}
        canPublish={can("posts.publish")}
        filterStatus="draft"
      />
    ),
  },
  {
    pattern: "/admin/posts/scheduled",
    exact: true,
    render: ({ onNavigate, can }) => (
      <PostsList
        onNavigate={onNavigate}
        canPublish={can("posts.publish")}
        filterStatus="scheduled"
      />
    ),
  },
  {
    pattern: "/admin/posts/published",
    exact: true,
    render: ({ onNavigate, can }) => (
      <PostsList
        onNavigate={onNavigate}
        canPublish={can("posts.publish")}
        filterStatus="published"
      />
    ),
  },
  {
    pattern: "/admin/posts/new",
    exact: true,
    render: ({ user, onNavigate, can }) => (
      <PostEditor
        currentUserId={user.id}
        canPublish={can("posts.publish")}
        onNavigate={onNavigate}
      />
    ),
  },
  {
    pattern: "/admin/posts/:postId",
    exact: true,
    render: ({ user, match, onNavigate, can }) => (
      <PostEditor
        postId={match.params.postId}
        currentUserId={user.id}
        canPublish={can("posts.publish")}
        onNavigate={onNavigate}
      />
    ),
  },
  // 3. Pages Routes
  {
    pattern: "/admin/pages",
    exact: true,
    render: ({ onNavigate, can }) => (
      <PagesList onNavigate={onNavigate} canPublish={can("pages.publish")} />
    ),
  },
  {
    pattern: "/admin/pages/new",
    exact: true,
    render: ({ user, onNavigate, can }) => (
      <PageEditor
        currentUserId={user.id}
        canPublish={can("pages.publish")}
        onNavigate={onNavigate}
      />
    ),
  },
  {
    pattern: "/admin/pages/:pageId",
    exact: true,
    render: ({ user, match, onNavigate, can }) => (
      <PageEditor
        pageId={match.params.pageId}
        currentUserId={user.id}
        canPublish={can("pages.publish")}
        onNavigate={onNavigate}
      />
    ),
  },
  // 4. Content Modeler & Custom Collections
  {
    pattern: "/admin/models",
    exact: true,
    render: ({ onNavigate }) => <ContentModelList onNavigate={onNavigate} />,
  },
  {
    pattern: "/admin/models/new",
    exact: true,
    render: ({ onNavigate }) => <ContentModelEditor onNavigate={onNavigate} />,
  },
  {
    pattern: "/admin/models/:modelId",
    exact: true,
    render: ({ match, onNavigate }) => (
      <ContentModelEditor modelId={match.params.modelId} onNavigate={onNavigate} />
    ),
  },
  {
    pattern: "/admin/collections/:modelSlug",
    exact: true,
    render: ({ match, onNavigate }) => (
      <DynamicCollectionList modelSlug={match.params.modelSlug || ""} onNavigate={onNavigate} />
    ),
  },
  {
    pattern: "/admin/collections/:modelSlug/new",
    exact: true,
    render: ({ match, onNavigate }) => (
      <DynamicCollectionEntryEditor modelSlug={match.params.modelSlug || ""} onNavigate={onNavigate} />
    ),
  },
  {
    pattern: "/admin/collections/:modelSlug/:entryId",
    exact: true,
    render: ({ match, onNavigate }) => (
      <DynamicCollectionEntryEditor
        modelSlug={match.params.modelSlug || ""}
        entryId={match.params.entryId}
        onNavigate={onNavigate}
      />
    ),
  },
  // 5. Automations & Growth Workflows
  {
    pattern: "/admin/automations",
    exact: true,
    render: () => <VisualAutomationBuilder />,
  },
  // 6. Content & Taxonomies
  {
    pattern: "/admin/tags",
    exact: true,
    render: () => <TagsManager />,
  },
  {
    pattern: "/admin/media",
    exact: false,
    render: () => <MediaLibrary />,
  },
  {
    pattern: "/admin/members",
    exact: false,
    render: () => <MembersList />,
  },
  // 5. Settings Hub Routes & Backward-Compatible Aliases
  {
    pattern: "/admin/settings",
    exact: true,
    render: ({ can }) => <SettingsHub initialSection="general" can={can} />,
  },
  {
    pattern: "/admin/settings/general",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="general" can={can} />,
  },
  {
    pattern: "/admin/settings/site",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="site" can={can} />,
  },
  {
    pattern: "/admin/settings/themes",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="site" can={can} />,
  },
  {
    pattern: "/admin/settings/storage",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="site" can={can} />,
  },
  {
    pattern: "/admin/settings/membership",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="membership" can={can} />,
  },
  {
    pattern: "/admin/settings/billing",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="membership" can={can} />,
  },
  {
    pattern: "/admin/subscriptions",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="membership" can={can} />,
  },
  {
    pattern: "/admin/settings/growth",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="growth" can={can} />,
  },
  {
    pattern: "/admin/newsletters",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="growth" can={can} />,
  },
  {
    pattern: "/admin/analytics",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="growth" can={can} />,
  },
  {
    pattern: "/admin/community",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="growth" can={can} />,
  },
  {
    pattern: "/admin/settings/advanced",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="advanced" can={can} />,
  },
  {
    pattern: "/admin/settings/platform",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="advanced" can={can} />,
  },
  {
    pattern: "/admin/settings/operations",
    exact: false,
    render: ({ can }) => <SettingsHub initialSection="advanced" can={can} />,
  },
];

/**
 * Resolves current path to matching route with guards, suspense, and error boundaries.
 */
export function renderAdminRoute(options: {
  pathname: string;
  user: ApiUser;
  onNavigate: (path: string) => void;
  can: (permissionKey: string) => boolean;
}): ReactNode {
  const { pathname, user, onNavigate, can } = options;

  let currentPathname = pathname;
  let searchParams = new URLSearchParams();

  try {
    const url = new URL(pathname, "http://localhost");
    currentPathname = url.pathname;
    searchParams = url.searchParams;
  } catch {
    // pathname is clean
  }

  for (const route of adminRoutes) {
    const { matches, params } = matchRoutePattern(
      route.pattern,
      currentPathname,
      route.exact ?? false,
    );

    if (matches) {
      if (route.requiredPermission && !can(route.requiredPermission)) {
        return (
          <RouteErrorBoundary>
            <PermissionDenied
              requiredPermission={route.requiredPermission}
              onNavigate={onNavigate}
            />
          </RouteErrorBoundary>
        );
      }

      return (
        <RouteErrorBoundary>
          <Suspense fallback={<RouteLoadingFallback />}>
            {route.render({
              user,
              match: {
                pathname: currentPathname,
                params,
                searchParams,
              },
              onNavigate,
              can,
            })}
          </Suspense>
        </RouteErrorBoundary>
      );
    }
  }

  // 404 Fallback
  return (
    <RouteErrorBoundary>
      <RouteNotFound path={currentPathname} onNavigate={onNavigate} />
    </RouteErrorBoundary>
  );
}
