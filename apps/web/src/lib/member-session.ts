import type { MemberAuthState, PublicMemberIdentity } from "@vibress/theme-core";

function getApiBaseUrl(): string {
  if (process.env.API_URL) {
    return process.env.API_URL.replace(/\/+$/, "");
  }
  if (process.env.API_PORT) {
    return `http://127.0.0.1:${process.env.API_PORT}`;
  }
  return "http://127.0.0.1:7780";
}

const UNAUTHENTICATED_STATE: MemberAuthState = {
  status: "unauthenticated",
  member: null,
};

/**
 * Server-side resolver for the currently authenticated public member.
 * Runs in Server Components / SSR without leaking secrets or tokens.
 */
export async function getCurrentPublicMember(
  explicitCookie?: string,
): Promise<MemberAuthState> {
  let cookieHeader = explicitCookie;
  let hostHeader: string | undefined;

  if (!cookieHeader) {
    try {
      const { cookies, headers } = await import("next/headers");
      const cookieStore = await cookies();
      const memberCookie =
        cookieStore.get("vibress_member_session") ||
        cookieStore.get("vb_member_session");
      if (!memberCookie?.value) {
        return UNAUTHENTICATED_STATE;
      }
      cookieHeader = `vibress_member_session=${memberCookie.value}`;

      const h = await headers();
      hostHeader = h.get("x-forwarded-host") || h.get("host") || undefined;
    } catch {
      // Outside Next.js server request context (e.g. build/static analysis)
      return UNAUTHENTICATED_STATE;
    }
  }

  if (!cookieHeader) {
    return UNAUTHENTICATED_STATE;
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/members/v1/session`;

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
        ...(hostHeader ? { "x-forwarded-host": hostHeader } : {}),
      },
    });

    if (!res.ok) {
      return UNAUTHENTICATED_STATE;
    }

    const data = (await res.json()) as {
      status?: "authenticated" | "unauthenticated";
      member?: PublicMemberIdentity | null;
    };

    if (data.status === "authenticated" && data.member?.id) {
      return {
        status: "authenticated",
        member: {
          id: data.member.id,
          name: data.member.name || "Member",
          avatarUrl: data.member.avatarUrl || null,
          initials: data.member.initials || "M",
        },
      };
    }

    return UNAUTHENTICATED_STATE;
  } catch (error) {
    console.error("[MemberSession] Error resolving public member session:", error);
    return UNAUTHENTICATED_STATE;
  }
}
