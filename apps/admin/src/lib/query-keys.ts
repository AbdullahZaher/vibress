import { QueryClient } from "@tanstack/react-query";

/**
 * Standardized Query Key Factory for Vibress Admin.
 * Prevents key collision and enables precise cache invalidation.
 */
export const adminQueryKeys = {
  auth: {
    all: ["auth"] as const,
    session: () => [...adminQueryKeys.auth.all, "session"] as const,
    permissions: () => [...adminQueryKeys.auth.all, "permissions"] as const,
  },
  setup: {
    all: ["setup"] as const,
    status: () => [...adminQueryKeys.setup.all, "status"] as const,
  },
  posts: {
    all: ["posts"] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminQueryKeys.posts.all, "list", filters ?? {}] as const,
    detail: (id: string) => [...adminQueryKeys.posts.all, "detail", id] as const,
    revisions: (id: string) =>
      [...adminQueryKeys.posts.all, "revisions", id] as const,
  },
  pages: {
    all: ["pages"] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminQueryKeys.pages.all, "list", filters ?? {}] as const,
    detail: (id: string) => [...adminQueryKeys.pages.all, "detail", id] as const,
  },
  tags: {
    all: ["tags"] as const,
    list: () => [...adminQueryKeys.tags.all, "list"] as const,
  },
  media: {
    all: ["media"] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminQueryKeys.media.all, "list", filters ?? {}] as const,
  },
  members: {
    all: ["members"] as const,
    list: (filters?: Record<string, unknown>) =>
      [...adminQueryKeys.members.all, "list", filters ?? {}] as const,
  },
  settings: {
    all: ["settings"] as const,
    namespace: (ns: string) =>
      [...adminQueryKeys.settings.all, "namespace", ns] as const,
    systemIntegrity: () =>
      [...adminQueryKeys.settings.all, "systemIntegrity"] as const,
  },
  analytics: {
    all: ["analytics"] as const,
    overview: (period?: string) =>
      [...adminQueryKeys.analytics.all, "overview", period ?? "30d"] as const,
  },
};

/**
 * Creates a configured QueryClient with resilient retry policies,
 * consistent cache retention, and error handling.
 */
export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 2, // 2 minutes fresh
        gcTime: 1000 * 60 * 10, // 10 minutes cache retention
        refetchOnWindowFocus: false,
        retry: (failureCount, error: unknown) => {
          const status = (error as { statusCode?: number; status?: number })?.statusCode ||
            (error as { statusCode?: number; status?: number })?.status;
          // Do not retry 401 Unauthorized, 403 Forbidden, or 404 Not Found
          if (status === 401 || status === 403 || status === 404) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
