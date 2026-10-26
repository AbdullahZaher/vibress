"use client";

import { useEffect, useState } from "react";

export interface HeaderMember {
  id: string;
  email: string;
  name: string | null;
  avatar?: string | null;
  avatarUrl?: string;
}

/**
 * Resolves the signed-in member from the session cookie.
 * Returns `null` while loading or when signed out, so SSR markup matches the signed-out state.
 */
export function useMember(): HeaderMember | null {
  const [member, setMember] = useState<HeaderMember | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/members/v1/me", {
      credentials: "include",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.member) setMember(data.member as HeaderMember);
      })
      .catch(() => {
        // signed out / offline: keep signed-out UI
      });
    return () => controller.abort();
  }, []);

  return member;
}
