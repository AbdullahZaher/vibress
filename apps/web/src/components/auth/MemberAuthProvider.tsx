"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import type {
  MemberAuthState,
  MemberAuthStatus,
  PublicMemberIdentity,
} from "@vibress/theme-core";

export interface ThemeMemberAuthContract {
  status: MemberAuthStatus;
  member: PublicMemberIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (returnUrl?: string) => void;
  signup: (returnUrl?: string) => void;
  account: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const MemberAuthContext = createContext<ThemeMemberAuthContract | null>(null);

const BROADCAST_CHANNEL_NAME = "vb_member_auth";

export interface MemberAuthProviderProps {
  children: React.ReactNode;
  initialAuth?: MemberAuthState;
}

export function MemberAuthProvider({
  children,
  initialAuth = { status: "unauthenticated", member: null },
}: MemberAuthProviderProps) {
  const router = useRouter();
  const [auth, setAuth] = useState<MemberAuthState>(initialAuth);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/members/v1/session", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setAuth({ status: "unauthenticated", member: null });
        return;
      }

      const data = (await res.json()) as {
        status?: "authenticated" | "unauthenticated";
        member?: PublicMemberIdentity | null;
      };

      if (data.status === "authenticated" && data.member?.id) {
        setAuth({
          status: "authenticated",
          member: {
            id: data.member.id,
            name: data.member.name || "Member",
            avatarUrl: data.member.avatarUrl || null,
            initials: data.member.initials || "M",
          },
        });
      } else {
        setAuth({ status: "unauthenticated", member: null });
      }
    } catch {
      // Retain current state or fallback safely on transient network failure
    }
  }, []);

  const login = useCallback(
    (returnUrl?: string) => {
      const target = returnUrl
        ? `/portal/#/signin?return=${encodeURIComponent(returnUrl)}`
        : "/portal/#/signin";
      if (typeof window !== "undefined") {
        window.location.href = target;
      }
    },
    [],
  );

  const signup = useCallback(
    (returnUrl?: string) => {
      const target = returnUrl
        ? `/portal/#/signup?return=${encodeURIComponent(returnUrl)}`
        : "/portal/#/signup";
      if (typeof window !== "undefined") {
        window.location.href = target;
      }
    },
    [],
  );

  const account = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/portal/#/account";
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/members/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
    } catch {
      // Ignore network errors on logout
    }

    setAuth({ status: "unauthenticated", member: null });

    // Notify other tabs
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({ type: "LOGOUT" });
    }

    router.refresh();
  }, [router]);

  // Setup multi-tab BroadcastChannel and focus synchronization
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastChannelRef.current = bc;

      bc.onmessage = (event) => {
        const type = event.data?.type;
        if (
          type === "AUTH_CHANGED" ||
          type === "LOGIN" ||
          type === "LOGOUT" ||
          type === "REFRESH"
        ) {
          refresh();
          router.refresh();
        }
      };
    }

    const handleFocus = () => {
      // Refresh session when returning to the tab to catch Portal logins/logouts
      refresh();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
        broadcastChannelRef.current = null;
      }
    };
  }, [refresh, router]);

  const value: ThemeMemberAuthContract = {
    status: auth.status,
    member: auth.member,
    isAuthenticated: auth.status === "authenticated" && auth.member !== null,
    isLoading: auth.status === "loading",
    login,
    signup,
    account,
    logout,
    refresh,
  };

  return (
    <MemberAuthContext.Provider value={value}>
      {children}
    </MemberAuthContext.Provider>
  );
}

/**
 * Standard hook for consuming canonical member auth state in components.
 */
export function useMemberAuth(): ThemeMemberAuthContract {
  const context = useContext(MemberAuthContext);
  if (!context) {
    return {
      status: "unauthenticated",
      member: null,
      isAuthenticated: false,
      isLoading: false,
      login: () => {
        if (typeof window !== "undefined") window.location.href = "/portal/#/signin";
      },
      signup: () => {
        if (typeof window !== "undefined") window.location.href = "/portal/#/signup";
      },
      account: () => {
        if (typeof window !== "undefined") window.location.href = "/portal/#/account";
      },
      logout: async () => {},
      refresh: async () => {},
    };
  }
  return context;
}

/**
 * Theme SDK Hook alias: allows themes to consume public member authentication
 * without knowing anything about tokens, cookies, sessions, or backend APIs.
 */
export function useThemeMember(): ThemeMemberAuthContract {
  return useMemberAuth();
}
