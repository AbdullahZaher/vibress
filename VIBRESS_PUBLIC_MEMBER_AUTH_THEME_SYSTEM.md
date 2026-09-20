# Vibress Public Member Authentication & Theme-Agnostic Identity System

## 1. Architectural Overview & Philosophy

Vibress enforces a strict separation of concerns across public identity, membership security, and theme rendering:

> **Vibress owns AUTHENTICATION and CANONICAL IDENTITY.**
> **Themes own VISUAL PRESENTATION.**

A Theme **must never** implement member authentication itself. A Theme must NOT:
- Parse session cookies (`vb_member_session` / `vibress_member_session`).
- Validate authentication tokens.
- Query database session tables or private internal API routes.
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
                    Theme API Contract (v1)
                             │
             ┌───────────────┼───────────────┐
             │               │               │
        Default Theme   Morrowe Theme   Future Theme
             │               │               │
       Visual Present. Custom Layout   Custom Present.
             │               │               │
             └───────────────┼───────────────┘
                             │
                   Authoritative Identity
                   (e.g., "عبدالله زاهر")
```

---

## 2. Canonical Public Member Identity & Theme API Contract (v1)

The canonical identity types and capability contract are exported from `@vibress/theme-core`:

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

/**
 * Versioned Theme Auth Contract (V1)
 * Canonical capability consumed by themes without knowledge of session/cookie internals.
 */
export interface ThemeAuthContractV1 {
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

## 4. Server-Side Member Resolution (SSR) & Cache Isolation

Server-side resolution runs in Next.js Server Components and Root Layout via `getCurrentPublicMember()` in `apps/web/src/lib/member-session.ts`:

1. Extracts `vibress_member_session` / `vb_member_session` cookie via `next/headers`.
2. Forwards incoming host header (`x-forwarded-host` or `host`) to preserve multi-tenant publication isolation.
3. Invokes the non-throwing public API endpoint `GET /api/members/v1/session`.
4. Returns the verified `MemberAuthState`.
5. Passes `initialAuth` into `<MemberAuthProvider initialAuth={initialAuth}>`.

### Cache Isolation & Request-Scoped Dynamic Identity
- Public post/page content is cached at the edge/application layer, while member identity is resolved dynamically per request.
- The root layout reads request headers/cookies dynamically, ensuring authenticated member HTML is never cached across distinct visitors or served to unauthenticated users.
- Verified with zero cross-request cache bleed.

---

## 5. Theme API SDK & Hooks

Themes consume the authentication capability through simple, high-level hooks without needing to understand backend mechanics:

### Hook Usage (`useThemeMember`)

```tsx
import { useThemeMember } from "@vibress/web/auth"; // or useMemberAuth()

export function CustomThemeHeader() {
  const auth = useThemeMember();

  if (auth.isLoading) {
    return <div className="skeleton-header" />;
  }

  if (auth.isAuthenticated && auth.member) {
    return (
      <div className="custom-member-pill">
        <span className="custom-avatar">{auth.member.initials || "M"}</span>
        <span className="custom-name">{auth.member.name}</span>
        <button onClick={auth.account} className="btn-account">Account</button>
        <button onClick={auth.logout} className="btn-logout">Sign out</button>
      </div>
    );
  }

  return (
    <button onClick={() => auth.login()} className="btn-signin">
      Sign in
    </button>
  );
}
```

### Optional Platform Component: `<MemberHeaderAuth />`

For themes opting for standard header configurations, Vibress provides a drop-in, fully accessible `<MemberHeaderAuth />` component. `<MemberHeaderAuth />` is an optional visual convenience; themes are free to render completely custom layouts.

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
4. BroadcastChannel carries only event signals (`{ type: "LOGIN" | "LOGOUT" | "REFRESH" }`), never sensitive tokens or session credentials.

---

## 7. Security Model & Credential Protection

1. **Server Authoritative**: Client-supplied `memberId`, `authorName`, or `userId` in POST/PATCH bodies are completely ignored. The HTTP-only session cookie is the single source of truth.
2. **HttpOnly & SameSite**: Session cookies are strictly `HttpOnly`, `SameSite: Lax`, and `Secure` in production environments.
3. **Publication Scope Isolation**: Member sessions are strictly tied to `publicationId`. A session for Publication A will never authenticate in Publication B.
4. **Zero Token Leakage**: Tokens and credentials never enter HTML payloads, JSON-LD scripts, client logs, or theme view models.
5. **Comments Consistency**: Comments, Header identity, and Member Portal profile all resolve to the exact same canonical `member.name` and `member.id`.

---

## 8. Accessibility Requirements

1. **Semantic Roles & ARIA**: Trigger buttons use `aria-haspopup="menu"`, `aria-expanded`, and descriptive labels (e.g. `t("member_menu")` / "Member account menu").
2. **Keyboard Navigation**: Full keyboard tab order, arrow navigation, and `Escape` key dismissal with focus restoration to the trigger button.
3. **RTL & Unicode**: Full support for right-to-left layout direction and non-Latin character sets.

---

## 9. Performance & Single-Request Contract

- **Zero N+1 Auth Requests**: Header, Footer, Comments, and Theme layouts share a single `MemberAuthProvider` context.
- **SSR Pre-resolution**: `initialAuth` is passed from the server layout to the client provider, eliminating client-side flash or secondary bootstrap `/session` fetch on first page load.
- **Background Refresh**: Token expiry and session status checks happen non-blockingly without layout disruption.

---

## 10. Cross-Theme Certification Matrix

| Theme | Implementation | SSR State | Client Hydration | Logged Out UI | Logged In UI | Logout Transition | Arabic RTL | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Default** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` + `Subscribe` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Molten** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` + `Subscribe` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Minimal** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Starter** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` + `Subscribe` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Morrowe** | `<MemberHeaderAuth />` | ✅ Verified | ✅ Seamless | `Sign in` + `Subscribe` | Avatar + Name + Dropdown | Instant refresh | ✅ Verified | **Certified** |
| **Synthetic 3rd-Party** | `useThemeMember()` | ✅ Verified | ✅ Seamless | `[ Sign in ]` | `[ عبدالله زاهر ▼ ]` | Instant transition | ✅ Verified | **Certified** |
