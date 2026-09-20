# Vibress Public Member Authentication & Theme-Agnostic Identity System

## 1. Architectural Overview & Philosophy

Vibress enforces a strict separation of concerns across public identity, membership security, and theme rendering:

> **Vibress owns AUTHENTICATION and CANONICAL IDENTITY.**
> **Themes own VISUAL PRESENTATION.**

A Theme **must never** implement member authentication itself. A Theme must NOT:
- Parse session cookies (`vb_member_session` / `vibress_member_session`).
- Validate authentication tokens.
- Call private administrative endpoints.
- Trust `memberId`, `authorId`, or `name` from client query strings or payload bodies.
- Determine authentication by querying browser `localStorage` or `sessionStorage`.
- Duplicate the Member session subsystem.

### Target Architecture Flow

```
                      VIBRESS PLATFORM
                             │
                   Canonical Member Auth
                             │
                    Public Member Context
                             │
                      Theme API Contract
                             │
             ┌───────────────┼───────────────┐
             │               │               │
        Default Theme   Molten Theme    Minimal Theme
             │               │               │
          Header          Header          Header
             │               │               │
             └───────────────┼───────────────┘
                             │
                   Authoritative Identity
                   (e.g., "عبدالله زاهر")
```

---

## 2. Canonical Public Member Identity Contract

The canonical identity shape exported from `@vibress/theme-core` is minimal, safe, and stripped of all private fields:

```typescript
export interface PublicMemberIdentity {
  id: string;
  name: string;
  avatarUrl?: string | null | undefined;
  initials?: string | undefined;
}

export type MemberAuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface MemberAuthState {
  status: MemberAuthStatus;
  member: PublicMemberIdentity | null;
}
```

### Safety Guarantees
- No email addresses, hashed passwords, session tokens, billing details, or audit metadata are exposed in `PublicMemberIdentity`.
- Arabic Unicode names (e.g. `عبدالله زاهر`) and RTL scripts are supported with proper grapheme-cluster-safe initials generation (`AZ` or `عز`).

---

## 3. Canonical Auth State Machine

Deterministic state transitions govern member sessions:

```
                  ┌───────────────┐
                  │    INITIAL    │
                  └───────┬───────┘
                          │ (SSR / Hydration)
                          ▼
                  ┌───────────────┐
                  │    LOADING    │
                  └───────┬───────┘
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
   ┌───────────────────┐     ┌─────────────────────┐
   │   AUTHENTICATED   │     │   UNAUTHENTICATED   │
   └─────────┬─────────┘     └──────────▲──────────┘
             │                          │
             ├─────────► LOGOUT ────────┤
             ├─────► SESSION_EXPIRED ───┤
             ├─────► SESSION_REVOKED ───┤
             ├─────► MEMBER_DISABLED ───┤
             └──────► ACCOUNT_DELETED ──┘
```

---

## 4. Server-Side Member Resolution (SSR)

Server-side resolution runs in Next.js Server Components and Root Layout via `getCurrentPublicMember()` in `apps/web/src/lib/member-session.ts`:

1. Extracts `vibress_member_session` / `vb_member_session` cookie via `next/headers`.
2. Forwards incoming host header (`x-forwarded-host` or `host`) to preserve multi-tenant publication isolation.
3. Invokes the non-throwing public API endpoint `GET /api/members/v1/session`.
4. Returns the verified `MemberAuthState`.
5. Passes `initialAuth` into `<MemberAuthProvider initialAuth={initialAuth}>`.

**SSR Result**: The page renders with the correct authenticated header on the server and hydrates on the client without layout shift, flicker, or hydration mismatches.

---

## 5. Theme API SDK & Hooks

Themes consume the authentication capability through simple, high-level hooks without needing to understand backend mechanics:

### Hook Usage

```tsx
import { useThemeMember } from "@vibress/web/auth"; // or useMemberAuth()

export function MyThemeHeader() {
  const { status, member, isAuthenticated, login, logout, account } = useThemeMember();

  if (status === "loading") {
    return <div className="skeleton-header" />;
  }

  if (isAuthenticated && member) {
    return (
      <div className="member-menu">
        <span className="member-name">{member.name}</span>
        <button onClick={account}>Account</button>
        <button onClick={logout}>Sign out</button>
      </div>
    );
  }

  return (
    <button onClick={() => login()} className="btn-signin">
      Sign in
    </button>
  );
}
```

### Reusable Platform Component: `<MemberHeaderAuth />`

For themes using standard header configurations, Vibress provides a drop-in, fully accessible `<MemberHeaderAuth />` component:

```tsx
import { MemberHeaderAuth } from "@vibress/web/auth";

export function HeaderNav() {
  return (
    <header className="vb-head">
      <div className="vb-head-brand">...</div>
      <div className="vb-head-actions">
        <MemberHeaderAuth
          signInClassName="vb-head-signin"
          subscribeClassName="vb-head-subscribe-btn"
        />
      </div>
    </header>
  );
}
```

---

## 6. Multi-Tab Synchronization (BroadcastChannel)

When a member logs in, logs out, or updates their profile in Portal or another browser tab:
1. Portal dispatches a lightweight message on `BroadcastChannel("vb_member_auth")` (`LOGIN`, `LOGOUT`, `REFRESH`).
2. All open public web tabs receive the event and refresh their member session state in the background.
3. If focus returns to the tab (`window.addEventListener("focus")`), session freshness is quietly verified.
4. No sensitive tokens or keys are ever stored in `localStorage`.

---

## 7. Security Model

1. **Server Authoritative**: Client-supplied `memberId`, `authorName`, or `userId` in POST/PATCH bodies are completely ignored. The HTTP-only session cookie is the single source of truth.
2. **HttpOnly & SameSite**: Session cookies are strictly `HttpOnly`, `SameSite: Lax`, and `Secure` in production environments.
3. **Publication Scope Isolation**: Member sessions are strictly tied to `publicationId`. A session for Publication A will never authenticate in Publication B.
4. **Zero Token Leakage**: Tokens and credentials never enter HTML payloads, JSON-LD scripts, client logs, or theme view models.
5. **Rate Limiting & CSRF**: Public endpoints are rate-limited and protected against origin spoofing.

---

## 8. Cross-Theme Certification Matrix

| Theme | Implementation | SSR State | Client Hydration | Logged Out UI | Logged In UI | Logout Transition | Arabic RTL | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Default** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` + `Subscribe` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Molten** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` + `Subscribe` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Minimal** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Synthetic 3rd-Party** | `useThemeMember()` | ✅ Verified | ✅ Seamless | `[ Sign in ]` | `[ Abdullah Zaher ▼ ]` | Instant transition | ✅ Verified | **Certified** |
