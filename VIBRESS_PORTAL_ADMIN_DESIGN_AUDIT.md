# Vibress — Portal Design System & Admin Visual Parity Audit
**Comprehensive UI/UX and Design-System Forensic Audit — Audit First, No Implementation**

---

## Executive Summary

This forensic audit evaluates the visual language, design-system architecture, component implementations, design tokens, accessibility, responsive behavior, and RTL capabilities of **`apps/portal`** (the Member Portal) against **`apps/admin`** (the Publication Management Console) within the Vibress monorepo.

### Core Audit Findings
1. **Architectural Isolation**: `apps/portal` and `apps/admin` operate as completely independent visual silos. While `apps/admin` has implemented a modern, tokenized design system powered by Tailwind CSS v4, CSS variables, `class-variance-authority` (CVA), and Lucide React icons, `apps/portal` relies entirely on hardcoded inline `React.CSSProperties` style objects with raw hex colors and zero shared component primitives.
2. **Design-System Drift**:
   - **Color Mismatch**: Admin uses a dark-first obsidian palette (`#15171a` / `#1d1f23` / `#2b2f36`) and a slate neutral scale (`#0f172a` primary in light mode), whereas Portal hardcodes an electric blue (`#2563eb` / `#1d4ed8`) as its primary accent.
   - **Component Duplication & Disparity**: Admin utilizes accessible, robust primitives (`Button`, `Input`, `Dialog`, `Card`, `Badge`, `Avatar`, `Table`, `Tabs`), while Portal implements ad-hoc `<input>`, `<button>`, and un-portaled inline modal overlays in individual page files.
   - **Iconography**: Admin standardizes on `lucide-react` across all surfaces; Portal uses raw Unicode characters (e.g. `✓`) or no icons at all.
3. **Design System Ownership**: The monorepo platform package **`packages/ui`** exists in an embryonic state (exporting only a basic string-joining `cn` utility and an unreferenced static token dictionary). Neither Admin nor Portal consumes `packages/ui`.
4. **Maturity Rating**: The current design system maturity is **Level A: Independent Applications**.
5. **Architectural Objective**: Bring Portal and Admin into the **same visual family** by elevating shared primitives and tokens into `packages/ui` without conflating application workflows (Admin management vs. Member self-service) and without coupling to the Public Theme System (`packages/theme-core`).

---

## Scope

- **Audit Target**: `apps/portal` (Member workflows: authentication, magic link verification, profile management, subscription management, newsletter preferences, in-app notifications, product/plan catalog).
- **Audit Baseline**: `apps/admin` (Publisher workflows: studio editor, settings hub, membership management, newsletter management, billing configuration, analytics dashboard, theme management).
- **Design System Target**: `packages/ui` (Shared platform component primitives and design tokens).
- **Exclusions**: `packages/theme-core` and public website Handlebars themes (which remain a separate presentation layer).
- **Constraint**: **AUDIT ONLY** — Zero application code, CSS, tokens, routes, or copy were modified. Zero commits created. Zero pushes executed.

---

## Repository Baseline

```bash
git status
On branch main
Your branch is ahead of 'origin/main' by 15 commits.
nothing to commit, working tree clean

git branch --show-current
main

git log --oneline -20
732dec1 (HEAD -> main) docs(auth): add final closure audit report and theme auth contract documentation
cb5230e feat(themes): version public member auth capability and harden SSR cache isolation
2c8fe04 feat(auth): build canonical public member auth and theme-agnostic identity system
610d4df fix(comments): bind authenticated member identity to comments and hydrate public author display name
a5b18d5 fix(comments): add defensive null checks for comment author and align public comment DTO
f4830b4 fix(themes): correct portal navigation URLs to /portal/#/signin and /portal/#/signup
75d43e0 docs(audit): add final closure audit report and retention policy reconciliation
cd6e72f test(core): stabilize latency threshold and pages multi-tenant isolation fixture
f278fdb security(members): harden deletion billing consistency, durable outbox, and retention reconciliation
d1f651f security(newsletters): make double opt-in scanner safe
3f8edcf test(e2e): add comprehensive member portal flow and update certification docs
f5b5d62 feat(api): harden member CSV import/export with formula injection defense
19c71a9 feat(portal): add i18n, RTL support, rich newsletter metadata, and account modals
7856b2e feat(newsletters): add double opt-in, token expiration, and bounded retries
81dd72a feat(members): harden member auth lifecycle, email change, and deletion
df1348a (origin/main, origin/HEAD) fix(collaboration): guarantee durable CRDT persistence and catchup across reconnects and disconnects
710d9f1 fix(e2e): align crdt room lifecycle stale buffer cleanup and scope studio card content selectors
4bdfd25 fix(comments): use onConflictDoNothing in comment repo for concurrent idempotency
d076df9 fix(setup): delete dependent post relations before users in setup test
09c1c4e fix(e2e): add db:seed step in CI and self-healing fixture post seeding

git diff --stat
(clean - 0 files changed)
```

---

## Portal Inventory

### 1. Application Entry & Router
- **Entry**: `apps/portal/index.html` -> `src/main.tsx` (wrapped in `<React.StrictMode>` and `<I18nProvider>`).
- **Router**: `src/router.tsx` — Lightweight client-side hash router (`window.location.hash` / `hashchange` listener) with fallback to path detection:
  - `#/sign-in` (or default): `SignInPage`
  - `#/check-email`: `CheckEmailPage`
  - `#/auth/verify`: `VerifyPage`
  - `#/account`: `AccountPage`
  - `#/plans` (aliases: `#/signup`, `#/sign-up`): `PlansPage`

### 2. Pages Map
| Page | File | Purpose | Key UI Elements |
|---|---|---|---|
| **Sign In** | `src/pages/SignInPage.tsx` | Member magic link sign-in request | Centered card (max 400px), Language switcher, Email input, Submit button, Error alert, Hint text |
| **Check Email** | `src/pages/CheckEmailPage.tsx` | Notification of magic link dispatch | Centered card (max 400px), Resend button with 30s countdown timer, Return to Sign-In link |
| **Verify** | `src/pages/VerifyPage.tsx` | One-time token verification & session exchange | Centered card (max 400px), State machine (`verifying`, `success`, `error`), Error descriptions for expired/used tokens, Redirect triggers |
| **Account** | `src/pages/AccountPage.tsx` | Member self-service hub | Centered card (max 540px), Profile name edit, Email display, Change Email Modal, Danger zone (Account Deletion Modal, Logout), Child sections |
| **Plans & Pricing** | `src/pages/PlansPage.tsx` | Membership product & tier catalog | Centered card (max 540px), Product listing, Tier cards, Trial day badges, Stripe Checkout trigger buttons |

### 3. Components Map
| Component | File | Purpose | UI Details |
|---|---|---|---|
| **SubscriptionSection** | `src/components/SubscriptionSection.tsx` | Lists active subscriptions & renewal info | Bordered card rows, Renewal/trial date formatters, "Manage", "Cancel", "Resume" action buttons, 8s polling refresher |
| **NewsletterPreferencesSection** | `src/components/NewsletterPreferencesSection.tsx` | Member newsletter opt-in/opt-out toggles | List of newsletter cards, Name & description, Native checkbox inputs, Subscribed/Unsubscribed labels |
| **NotificationsSection** | `src/components/NotificationsSection.tsx` | In-app notification list | Notification items, Unread counter badge, Mark individual read (`✓`), Mark all read button |
| **LanguageSwitcher** | `src/lib/i18n.tsx` | EN / AR language toggle | Two inline buttons (`portal-lang-en`, `portal-lang-ar`) with active state background `#2563eb` |

### 4. Styling & Dependencies
- **Dependencies** (`apps/portal/package.json`): `react` (18.3.1), `react-dom` (18.3.1), `@vibress/i18n` (workspace).
- **DevDependencies**: `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`.
- **CSS / Styling Implementation**: 100% Inline styles (`styles: Record<string, React.CSSProperties> = { ... }`).
- **Icons**: Zero icon library imported. Uses unicode `✓` in notifications.

---

## Admin Design System Inventory

### 1. Tooling & Dependencies
- **Dependencies** (`apps/admin/package.json`):
  - `@tailwindcss/vite` (^4.3.3) & `tailwindcss` (^4.3.3)
  - `class-variance-authority` (^0.7.1)
  - `clsx` (^2.1.1) & `tailwind-merge` (^3.6.0)
  - `lucide-react` (^1.30.0)
  - `@tanstack/react-query` (^5.51.15) & `@tanstack/react-router` (^1.45.10)
  - `@vibress/i18n` (workspace)

### 2. Global Design Tokens (`apps/admin/src/styles/globals.css`)
- **Tailwind v4 Theme Layer**:
  - Semantic Color Tokens: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`.
  - Sidebar Tokens: `--sidebar-background`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`.
  - Status Tokens: `--status-published-*`, `--status-draft-*`, `--status-scheduled-*`, `--status-review-*`, `--status-danger-*`.
  - Surface Tokens: `--surface-elevated`.
- **Theme Modes**:
  - **Light Mode (`:root`)**: Pure slate neutral palette (`--background: #f8fafc`, `--foreground: #0f172a`, `--card: #ffffff`, `--primary: #0f172a`, `--border: #e2e8f0`).
  - **Dark Mode (`.dark`)**: Vibress canonical obsidian dark palette (`--background: #15171a`, `--card: #1d1f23`, `--border: #2b2f36`, `--muted-foreground: #738a94`, `--ring: #3eb083`).
- **Focus Ring Standard**: `:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }`.
- **Motion Standard**: `@media (prefers-reduced-motion: reduce) { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }`.
- **RTL Typography Standard**: `[dir="rtl"]` font hierarchy with tuned line-heights (e.g. 1.95 for body prose, 1.4 for H1) and letter-spacing normalization.

### 3. Component Primitives (`apps/admin/src/components/ui/`)
- **`Button`** (`button.tsx`): CVA-based with variants (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`) and sizes (`default` h-9, `sm` h-8, `xs` h-7, `lg` h-10, `icon` h-9 w-9, `icon-sm` h-7 w-7). Active scaling (`active:scale-[0.99]`), focus rings, disabled opacity.
- **`Input`** (`input.tsx`): ForwardRef input with `h-9`, `border-border/70`, `bg-background`, `shadow-2xs`, `focus-visible:ring-ring`.
- **`Dialog`** (`dialog.tsx`): Full modal primitive with `createPortal` to `document.body`, `role="dialog"`, `aria-modal="true"`, backdrop blur (`bg-black/60 backdrop-blur-xs`), smooth entry animation (`zoom-in-95`), Escape key listener, body scroll lock, and logical close button placement (`end-4`).
- **`Card`** (`card.tsx`): Compound component system (`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) with `rounded-xl border border-border/70 bg-card shadow-2xs`.
- **`Badge`** (`badge.tsx`): CVA-based with variants (`default`, `secondary`, `published`, `draft`, `scheduled`, `success`, `warning`, `review`, `info`, `destructive`, `outline`).
- **`Avatar`** (`avatar.tsx`): Fallback text uppercase generator with image error fallbacks, sizes `sm` (h-7 w-7), `md` (h-9 w-9), `lg` (h-12 w-12).
- **`Table`** (`table.tsx`): Complete HTML5 semantic table with `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`, featuring logical alignments (`text-start`, `pe-6`, `ps-6`).
- **`Tabs`** (`tabs.tsx`): Controlled tab primitives (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) with React context.

---

## Current Architecture

```
                                VIBRESS MONOREPO
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
   packages/ui                    apps/admin                     apps/portal
        │                              │                              │
  (Embryonic)                    (Self-Contained)               (Self-Contained)
  - Raw cn joiner                - Tailwind CSS v4              - Zero Tailwind
  - Static tokens                - globals.css (604 lines)      - Zero CSS files
  - Unused by apps               - Custom CVA Primitives        - 100% Inline CSS
                                 - Lucide React Icons           - Hardcoded Blue #2563eb
                                 - Light & Dark (#15171a)       - Light Mode Only
                                 - Portaled Dialogs             - Unportaled Div Modals
```

---

## Component Comparison Matrix

| Component | Admin Implementation | Portal Implementation | Shared in `packages/ui`? | Visual Match | Recommendation |
|---|---|---|---|---|---|
| **Button** | `apps/admin/src/components/ui/button.tsx` (CVA, 6 variants, 6 sizes, focus ring, active scale) | 6 inline style objects (`styles.button`, `styles.secondaryButton`, `styles.deleteButton`, `styles.confirmDeleteButton`, `styles.cancelModalButton`, `styles.logout`) | No | ❌ Severe Drift (Primary is Blue in Portal vs. Slate/Obsidian in Admin) | **CONSOLIDATE**: Move Admin `Button` to `packages/ui/src/button.tsx` and consume in both apps. |
| **IconButton** | `Button size="icon"` or `size="icon-sm"` with Lucide icon | Inline button without icon or custom character | No | ❌ Severe Drift | **CONSOLIDATE**: Standardize in `packages/ui`. |
| **Input** | `apps/admin/src/components/ui/input.tsx` (ForwardRef, `h-9`, `border-border/70`, `shadow-2xs`, focus ring) | Native `<input>` with inline `styles.input` (hardcoded padding, border `#cbd5e1`, margin) | No | ❌ Drift (Border colors, focus rings, and heights differ) | **CONSOLIDATE**: Move Admin `Input` to `packages/ui/src/input.tsx`. |
| **Select** | Styled native `<select className="h-8 text-xs bg-card border-border rounded-md px-2">` | Not used in Portal | No | ⚠️ One-off | **CONSOLIDATE**: Create `Select` primitive in `packages/ui`. |
| **Textarea** | Custom styled textarea in Admin studio/settings | Not used in Portal | No | ⚠️ One-off | **CONSOLIDATE**: Create `Textarea` primitive in `packages/ui`. |
| **Checkbox** | Custom styled checkbox with accent color `accent-color: var(--primary)` | Native `<input type="checkbox">` with inline cursor style in `NewsletterPreferencesSection` | No | ❌ Drift | **CONSOLIDATE**: Create accessible `Checkbox` primitive in `packages/ui`. |
| **Radio** | Admin settings custom radio buttons | Not used in Portal | No | ⚠️ One-off | **CONSOLIDATE**: Add to `packages/ui`. |
| **Switch** | Admin settings toggle switch | Not used in Portal (uses Checkbox) | No | ⚠️ One-off | **CONSOLIDATE**: Add `Switch` primitive to `packages/ui`. |
| **FormField & Label** | Admin form rows with `label.text-xs.font-medium.text-foreground` | Inline `styles.label` (`fontSize: 13, fontWeight: 600`) | No | ❌ Drift | **CONSOLIDATE**: Create `FormField` and `Label` primitives in `packages/ui`. |
| **Card** | `apps/admin/src/components/ui/card.tsx` (Compound: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) | Flat `styles.card` with hardcoded 12px radius, 32px padding, and 16px box shadow | No | ❌ Drift (Visual styling, padding, and structural slots differ) | **CONSOLIDATE**: Move `Card` suite to `packages/ui` and consume in Portal. |
| **Modal / Dialog** | `apps/admin/src/components/ui/dialog.tsx` (React portal, `role="dialog"`, `aria-modal`, backdrop blur, zoom animation, Escape key, scroll lock) | Inline `position: fixed` `div` overlay in `AccountPage` without portal or ARIA semantics | No | ❌ Severe Drift & A11y Failure | **CONSOLIDATE**: Move Admin `Dialog` to `packages/ui` and use for Portal Change Email & Delete Account modals. |
| **Drawer** | Admin Mobile Sidebar drawer | Not used in Portal | No | Admin-Only | **KEEP ADMIN-ONLY**. |
| **Dropdown / Popover** | `UserMenu.tsx` / `CommandPalette.tsx` (Glassy popover, `rounded-2xl bg-card border-border shadow-2xl`, Escape key) | Not used in Portal | No | ⚠️ Missing in Portal | **CONSOLIDATE**: Create `Dropdown` primitive in `packages/ui`. |
| **Tooltip** | Admin custom tooltips (`title` attributes and floating popups) | `title` attributes only | No | ⚠️ Basic | **CONSOLIDATE**: Add `Tooltip` primitive to `packages/ui`. |
| **Tabs** | `apps/admin/src/components/ui/tabs.tsx` (Context-based `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) | Not used in Portal | No | Admin-Only | **CONSOLIDATE**: Move `Tabs` to `packages/ui`. |
| **Badge** | `apps/admin/src/components/ui/badge.tsx` (CVA with 11 semantic variants) | Raw colored spans (e.g. unread count `(#)`, trial days text) | No | ❌ Drift | **CONSOLIDATE**: Move `Badge` to `packages/ui` and consume in Portal for subscription statuses & unread badges. |
| **Alert / Banner** | Admin inline alert banners (`p-3 rounded-lg bg-red-500/10 border-red-500/20 text-red-600`) with Lucide icons | Raw `<p role="alert">` with inline `#dc2626` color and no icon | No | ❌ Drift | **CONSOLIDATE**: Create `Alert` primitive in `packages/ui`. |
| **Toast** | Admin notification banners | Not used in Portal | No | ⚠️ Missing | **CONSOLIDATE**: Create `Toast` primitive in `packages/ui`. |
| **Avatar** | `apps/admin/src/components/ui/avatar.tsx` (Initials fallback, image error fallback, 3 sizes) | Text-only member email display in `AccountPage` | No | ❌ Missing in Portal | **CONSOLIDATE**: Move `Avatar` to `packages/ui` and use in Portal `AccountPage`. |
| **Skeleton** | Admin loading skeleton rows | Not used in Portal | No | ⚠️ Missing | **CONSOLIDATE**: Create `Skeleton` primitive in `packages/ui`. |
| **Spinner** | CSS keyframe `animate-spin` on Lucide `RefreshCw` or custom circular border | Plain text ("Sending...", "Loading...") | No | ❌ Drift | **CONSOLIDATE**: Create `Spinner` primitive in `packages/ui`. |
| **Table** | `apps/admin/src/components/ui/table.tsx` (Semantic HTML5 table suite) | Stacked divs in Portal `SubscriptionSection` | No | Admin-Only / Portal Stacks | **CONSOLIDATE**: Move `Table` to `packages/ui`. |
| **Pagination** | Admin pagination controls in Posts/Members list | Not used in Portal (max 50 limit) | No | Admin-Only | **KEEP ADMIN-ONLY**. |
| **Navigation / Header** | `MobileHeader.tsx` (Sticky `h-14`, backdrop blur, logo, language & theme toggles) | In-card header with `LanguageSwitcher` | No | ❌ Different layout models | **PORTAL-SPECIFIC**: Keep Portal card header layout, but align buttons, tokens, and `LanguageSwitcher` styling. |
| **Sidebar** | `AppSidebar.tsx` (Full multi-level collapsible sidebar) | None (Portal is a focused single-view application) | No | Admin-Only | **KEEP ADMIN-ONLY**. |
| **Breadcrumb** | Admin path breadcrumbs | None | No | Admin-Only | **KEEP ADMIN-ONLY**. |
| **Empty State** | Admin icon + title + description centered layout (e.g. `<Users className="h-8 w-8 text-muted-foreground/40"/>`) | Plain `<p>` ("No members found", "No newsletters") | No | ❌ Severe Visual Drift | **CONSOLIDATE**: Create `EmptyState` primitive in `packages/ui`. |
| **Error State** | Admin error cards / alerts with `AlertCircle` icon | Inline `<p style={{ color: "#dc2626" }}>` | No | ❌ Severe Visual Drift | **CONSOLIDATE**: Use `Alert` primitive. |
| **Loading State** | Admin centered `RefreshCw` spinner with `animate-spin` | Plain text `<p style={styles.status}>Loading...</p>` | No | ❌ Severe Visual Drift | **CONSOLIDATE**: Use `Spinner` primitive. |
| **Confirmation Dialog** | Admin `Dialog` with confirmation actions | Custom un-portaled inline modal in `AccountPage` | No | ❌ Severe Drift | **CONSOLIDATE**: Use `Dialog` primitive. |

---

## Design Token Comparison

### 1. Colors

| Token Name | Admin Token Value (Light) | Admin Token Value (Dark) | Portal Current Value | Status |
|---|---|---|---|---|
| `--background` | `#f8fafc` | `#15171a` | `#f8fafc` (inline) | ⚠️ Light matches; Dark missing in Portal |
| `--foreground` | `#0f172a` | `#f8fafc` | `#0f172a` / `#334155` / `#1e293b` (inconsistent) | ❌ Inconsistent text tokens |
| `--card` | `#ffffff` | `#1d1f23` | `#ffffff` (inline) | ⚠️ Light matches; Dark missing |
| `--card-foreground` | `#0f172a` | `#f8fafc` | `#0f172a` (implicit) | ⚠️ Light matches; Dark missing |
| `--primary` | `#0f172a` | `#f8fafc` | `#2563eb` (hardcoded electric blue) | ❌ **CRITICAL DRIFT** (Admin is Slate/Obsidian; Portal is Blue) |
| `--primary-foreground` | `#ffffff` | `#15171a` | `#ffffff` (inline) | ⚠️ Depends on primary |
| `--secondary` | `#f1f5f9` | `#22252a` | `#f1f5f9` (inline) | ⚠️ Light matches; Dark missing |
| `--secondary-foreground` | `#0f172a` | `#f8fafc` | `#1e293b` / `#475569` (inline) | ❌ Inconsistent |
| `--muted` | `#f1f5f9` | `#22252a` | `#f1f5f9` (inline) | ⚠️ Light matches; Dark missing |
| `--muted-foreground` | `#64748b` | `#738a94` | `#64748b` / `#94a3b8` / `#475569` (inline) | ❌ Inconsistent |
| `--destructive` | `#ef4444` | `#f87171` | `#dc2626` / `#b91c1c` / `#be123c` (inline) | ❌ Inconsistent red tokens |
| `--destructive-foreground`| `#ffffff` | `#ffffff` | `#ffffff` (inline) | ✅ Matches |
| `--border` | `#e2e8f0` | `#2b2f36` | `#cbd5e1` / `#e2e8f0` / `#fee2e2` (inline) | ❌ Inconsistent border grays |
| `--input` | `#e2e8f0` | `#2b2f36` | `#cbd5e1` (inline) | ❌ Inconsistent (`#cbd5e1` in Portal vs `#e2e8f0` in Admin) |
| `--ring` | `#0f172a` | `#3eb083` | None (Browser default blue outline) | ❌ Focus rings missing in Portal |

### 2. Typography

| Metric | Admin Specification | Portal Specification | Status |
|---|---|---|---|
| **Font Family** | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif` | ⚠️ Similar fallbacks, but Portal specifies "Noto Sans Arabic" inline while Admin uses system stack with RTL line-height scaling. |
| **H1 (Page Title)** | `text-xl font-bold tracking-tight` (20px / 28px) or `text-2xl font-black` (24px) | `fontSize: 22` or `24`, `fontWeight: 700` | ⚠️ Hardcoded px vs Tailwind rem |
| **H2 (Section Title)**| `text-base sm:text-lg font-semibold` (16px / 18px) | `fontSize: 16` or `17` or `18`, `fontWeight: 600` or `700` | ❌ Inconsistent hierarchy |
| **Body Text** | `text-xs sm:text-sm text-foreground leading-relaxed` (12px / 14px) | `fontSize: 14, color: "#334155"` | ⚠️ Close, but non-tokenized |
| **Caption / Subtitle**| `text-xs text-muted-foreground leading-relaxed` (12px) | `fontSize: 13` or `14`, `color: "#64748b"` | ⚠️ Non-tokenized |
| **Label** | `text-xs font-medium text-foreground` (12px) | `fontSize: 13, fontWeight: 600` | ❌ Disparity in label weight & size |
| **Helper / Hint Text**| `text-[11px] text-muted-foreground` (11px) | `fontSize: 12` or `13`, `color: "#94a3b8"` | ⚠️ Non-tokenized |

### 3. Spacing & Geometry

| Element | Admin Value | Portal Value | Status |
|---|---|---|---|
| **Page / Container Padding** | `p-4 sm:p-6 md:p-8` | `padding: 16` or `32px 16px` | ❌ Arbitrary inline padding |
| **Card Max Width** | `max-w-md` (448px) or `max-w-7xl` (1280px) | `max-w: 400px` (Auth) or `540px` (Account/Plans) | ⚠️ Layout specific, but non-tokenized |
| **Card Padding** | `p-5 sm:p-6` (20px / 24px) | `padding: 32` (32px) | ❌ Disparity (Portal cards are excessively padded on mobile) |
| **Card Radius** | `rounded-xl` (12px) | `borderRadius: 12` (12px) | ✅ Geometric match |
| **Button Radius** | `rounded-md` (6px) or `rounded-lg` (8px) | `borderRadius: 6` or `8` (inconsistent) | ❌ Inconsistent |
| **Input Height** | `h-9` (36px) or `h-8` (32px) | `padding: 10px 12px` (~38-40px total height) | ❌ Input height mismatch |
| **Button Height** | `h-9` (36px), `h-8` (32px), `h-7` (28px), `h-10` (40px) | `padding: 11px 16px` (~42px) or `9px 16px` (~38px) | ❌ Button height mismatch |
| **Modal Radius** | `rounded-xl` (12px) or `rounded-2xl` (16px) | `borderRadius: 12` (12px) | ✅ Geometric match |
| **Modal Padding** | `p-6` (24px) | `padding: 24` (24px) | ✅ Geometric match |

### 4. Elevation & Shadows

| Element | Admin Shadow Token | Portal Shadow Inline | Status |
|---|---|---|---|
| **Cards** | `shadow-2xs` (`0 1px 2px rgba(0,0,0,0.04)`) or `shadow-sm` | `boxShadow: "0 4px 16px rgba(0,0,0,0.08)"` | ❌ Portal uses heavier drop-shadow |
| **Modals** | `shadow-2xl` + `backdrop-blur-xs` | `boxShadow: "0 20px 25px -5px ..."` (no backdrop filter) | ❌ Portal lacks backdrop blur |
| **Buttons** | `shadow-2xs` with hover `shadow-xs` | `boxShadow: none` | ⚠️ Inconsistent elevation |

---

## Visual Language Audit

### 1. Header Treatment
- **Admin**: Features a sticky `MobileHeader` (`h-14`, `bg-background/95 backdrop-blur-md`, `border-b border-border`) with standard Vibress brand logo, route title, language toggle button, command palette trigger, and dark/light theme switch.
- **Portal**: Contains no app-level header. Instead, each standalone card houses an inline top bar containing the `LanguageSwitcher` component in the top-right corner.
- **Verdict**: Portal does not require a full admin navigation header because it is a single-purpose member flow. However, the top bar controls (LanguageSwitcher, brand typography, logo) should adopt Admin's exact button geometry, borders, and tokenized colors.

### 2. Form Controls & Validation
- **Admin**:
  - Labels: `text-xs font-medium text-foreground`.
  - Inputs: `h-9 bg-background border border-border/70 rounded-md px-3 text-xs sm:text-sm focus-visible:ring-2 focus-visible:ring-ring`.
  - Validation: Semantic banner with icon `<AlertCircle className="h-4 w-4"/>` and `bg-red-500/10 border-red-500/20 text-red-600`.
- **Portal**:
  - Labels: `fontSize: 13, fontWeight: 600, color: default`.
  - Inputs: `padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8`.
  - Validation: Plain `<p style={{ color: "#dc2626" }}>` without icon.
- **Verdict**: Form styling is completely divergent. Portal inputs must be migrated to the shared `Input`, `FormField`, and `Label` primitives.

### 3. Button Hierarchy
- **Admin**:
  - Primary: `bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs`.
  - Secondary: `bg-secondary text-secondary-foreground hover:bg-secondary/80`.
  - Outline: `border border-border/80 bg-card text-foreground hover:bg-accent`.
  - Destructive: `bg-destructive text-destructive-foreground hover:bg-destructive/90`.
- **Portal**:
  - Primary: `backgroundColor: "#2563eb", color: "#ffffff"`.
  - Secondary: `backgroundColor: "#f1f5f9", color: "#1e293b", border: "1px solid #cbd5e1"`.
  - Destructive: `backgroundColor: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3"`.
  - Confirm Destructive: `backgroundColor: "#dc2626", color: "#ffffff"`.
- **Verdict**: Button styling must be consolidated to the shared CVA `Button` primitive.

---

## Authentication UI Audit

| Flow / View | Admin Implementation (`LoginPage.tsx`) | Portal Implementation (`SignInPage.tsx` / `CheckEmailPage.tsx` / `VerifyPage.tsx`) | Parity Gaps |
|---|---|---|---|
| **Sign In Form** | Uses `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, Lucide icons (`Lock`, `Mail`, `ArrowRight`), animated spinner button. | Plain `div` card with inline styles, no icons, text-only "Sending..." button. | ❌ Portal lacks card structure, icons, and animated loading state. |
| **Magic Link Request** | Not applicable to Admin staff (Admin uses password). | Form posts to `/api/members/v1/auth/send-magic-link`, redirects to `#/check-email`. | Functional flow is sound, but visual language diverges from Admin. |
| **Check Email Screen** | Not applicable to Admin. | `CheckEmailPage` with 30s countdown timer and resend button. | ❌ Uses hardcoded `#2563eb` button and un-tokenized countdown text. |
| **Verify Token Screen** | Not applicable to Admin. | `VerifyPage` with 3 states (`verifying`, `success`, `error`). | ❌ Loading state is raw text instead of standard animated spinner. Error state lacks alert banner styling. |
| **Session Expired Screen**| Admin redirects to `/admin/login` or shows `RouteErrorBoundary`. | Inline card inside `AccountPage` showing "Your session is no longer valid". | ❌ Lacks icon, uses non-standard button styling. |

---

## Account & Member Experience Audit

### 1. Profile Management
- **Portal**: Allows editing the member's name and viewing their registered email and creation date.
- **Issues**:
  - Hardcoded input with `#cbd5e1` border.
  - "Save Profile" button uses hardcoded blue `#2563eb`.
  - Success message is plain `<p style={{ color: "#166534" }}>` instead of Admin's emerald alert badge with `CheckCircle2` icon.

### 2. Email Change Modal
- **Portal**: Triggered by `#btn-open-change-email`.
- **Issues**:
  - Rendered as an un-portaled `div` overlay in `AccountPage.tsx:248-298`.
  - Lacks `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
  - Lacks Escape key handler and focus trap.
  - Cancel and Submit buttons use non-tokenized inline styles.

### 3. Account Deletion Modal (Danger Zone)
- **Portal**: Triggered by `#btn-open-delete-account`.
- **Issues**:
  - Rendered as an un-portaled `div` overlay in `AccountPage.tsx:300-335`.
  - Lacks ARIA dialog semantics and focus trapping.
  - Destructive red styling uses `#dc2626` / `#b91c1c` directly instead of `--destructive` tokens.

### 4. Subscription Section
- **Portal**: `SubscriptionSection.tsx` polls `/api/members/v1/subscriptions` every 8 seconds.
- **Issues**:
  - Rendered using stacked custom bordered divs instead of standard card rows.
  - Status display lacks `Badge` component primitives.
  - "Upgrade Plan" button uses hardcoded `#2563eb`.

### 5. Newsletter Preferences Section
- **Portal**: `NewsletterPreferencesSection.tsx` lists newsletters with checkbox inputs.
- **Issues**:
  - Checkboxes are native unstyled browser inputs.
  - Subscribed background is hardcoded `#f0fdf4` instead of semantic status token (`var(--status-published-bg)` or `bg-emerald-500/10`).

### 6. Notifications Section
- **Portal**: `NotificationsSection.tsx` lists notifications.
- **Issues**:
  - Unread count uses raw red text `(#)` instead of a standard `Badge`.
  - Mark-as-read button uses raw unicode character `✓` instead of Lucide `Check` icon.
  - Unread background is hardcoded `#f0fdf4`.

---

## Responsive Design Audit

| Viewport Width | Device Category | Admin Behavior | Portal Behavior | Responsive Issues Identified |
|---|---|---|---|---|
| **320px** | Small Phone (iPhone SE) | Fluid grid, compact buttons (`h-8`), responsive tables with scroll containers | Card has `padding: 32px 16px`, causing content to squeeze into ~256px inner width | ⚠️ Card padding is too large for 320px (should be `p-5` / 20px on mobile). |
| **375px - 390px** | Standard Phone (iPhone 13/14) | Sticky top bar (`h-14`), full-width cards, optimized touch targets | Card centered with 16px margin, max-w-400/540 | ⚠️ LanguageSwitcher buttons are 24px high, failing 44px minimum touch target size. |
| **430px** | Large Phone (iPhone 14 Pro Max) | Full-width cards, 16px margins | Centered card, layout stable | ✅ Acceptable. |
| **768px** | Tablet (iPad Portrait) | Sidebar collapses into drawer, grid converts to 2 columns | Centered card (`max-w-540px`) on light gray background | ✅ Acceptable. |
| **1024px** | Small Desktop / Tablet Landscape | Expanded sidebar, multi-column grids | Centered card (`max-w-540px`) | ⚠️ Massive unused whitespace around single centered card. (Acceptable for auth, but Plans could support multi-column). |
| **1280px - 1440px**| Standard Desktop | Full dashboard layout, max-w-7xl content container | Centered card (`max-w-540px`) | ✅ Focused experience for member account. |
| **1920px** | Widescreen Desktop | Centered content with max-w boundaries | Centered card | ✅ Stable layout. |

---

## RTL & Arabic Audit

### 1. Direction & Localization Binding
- **Admin**: Sets `html[dir="rtl"]` and `html[lang="ar"]` when toggled.
- **Portal**: Sets `document.documentElement.dir = direction` and `lang = locale` via `I18nProvider`.
- **Verdict**: Both applications correctly integrate with `@vibress/i18n`.

### 2. CSS Logical Properties Comparison
- **Admin**: Employs Tailwind logical properties across the codebase (`start-2.5`, `end-4`, `ps-6`, `pe-6`, `ms-8`, `me-8`, `text-start`, `border-inline-start`).
- **Portal**: Mixed implementation:
  - Uses `textAlign: "start"`, `marginInlineEnd: 12`, and `marginInlineStart: 8` in some components.
  - However, uses physical properties like `margin: "0 0 12px"`, `padding: "10px 12px"`, and hardcoded `justifyContent: "flex-end"` (which places the language switcher on the right side in both LTR and RTL, rather than logical end).

### 3. Arabic Typography
- **Admin**: `globals.css` applies specific RTL typographic rules:
  ```css
  [dir="rtl"] .studio-paragraph, html[dir="rtl"] .studio-paragraph { line-height: 1.95; letter-spacing: normal; }
  [dir="rtl"] .studio-h1, html[dir="rtl"] .studio-h1 { letter-spacing: normal; line-height: 1.4; }
  ```
- **Portal**: Relies on system fonts without RTL line-height adjustments, causing Arabic text to appear cramped in dense headings.

---

## Accessibility Audit (WCAG 2.2 AA Baseline)

| Accessibility Criterion | WCAG Level | Admin Status | Portal Status | Detailed Findings |
|---|---|---|---|---|
| **1.4.3 Contrast (Minimum)** | AA | ✅ Pass (All color tokens exceed 4.5:1 ratio) | ❌ **Fail** (P1) | Hint text `#94a3b8` on `#ffffff` background has a contrast ratio of **2.54:1** (fails 4.5:1). Secondary button text `#475569` on `#f1f5f9` has a contrast ratio of **3.8:1** (fails 4.5:1). |
| **2.1.1 Keyboard Navigation** | A | ✅ Pass (All dialogs, tabs, and buttons are keyboard accessible with Escape handlers) | ❌ **Fail** (P0) | Portal modals in `AccountPage` (Change Email, Delete Account) lack Escape key listeners and do not trap keyboard focus within the modal container. |
| **2.4.7 Focus Visible** | AA | ✅ Pass (`:focus-visible { outline: 2px solid var(--ring); }`) | ❌ **Fail** (P1) | Portal inline inputs and buttons specify `border: none` or custom borders without `:focus-visible` ring indicators, relying on default or missing browser outlines. |
| **2.5.5 / 2.5.8 Target Size** | AA | ✅ Pass (Buttons are minimum 32px-36px with adequate spacing) | ❌ **Fail** (P1) | `LanguageSwitcher` buttons and notification mark-read `✓` buttons have touch target heights of only ~24px, violating the 44px minimum touch target guideline. |
| **4.1.2 Name, Role, Value** | A | ✅ Pass (Dialogs use `role="dialog"`, `aria-modal="true"`, `aria-label`) | ❌ **Fail** (P0) | Portal modals are plain `div` elements without `role="dialog"`, `aria-modal="true"`, or `aria-labelledby`. |
| **4.1.3 Status Messages** | AA | ✅ Pass (Alerts use semantic regions) | ⚠️ **Partial** (P2) | Loading states in `SignInPage`, `VerifyPage`, and `AccountPage` do not use `aria-live="polite"` or `aria-busy="true"`. |

---

## Interaction Design Audit

| Interaction State | Admin Behavior | Portal Behavior | Parity Gaps |
|---|---|---|---|
| **Hover** | Smooth `transition-colors duration-150` with subtle background shifts (`hover:bg-accent`, `hover:bg-muted/80`). | Static or abrupt inline hover styles (most inline styles have no hover transitions). | ❌ Portal feels static and non-interactive. |
| **Active / Press** | `active:scale-[0.99]` providing tactile click feedback. | None. | ❌ Portal lacks tactile micro-interactions. |
| **Focus Visible** | High-contrast ring `ring-2 ring-ring ring-offset-1`. | Inconsistent default browser outline. | ❌ Focus states are inconsistent. |
| **Loading Action** | Button retains dimensions, displays animated spinner (`animate-spin`) + "Saving...". | Button text changes to "Saving..." or "Sending...", causing layout shift / width collapse. | ❌ Layout shift on submit in Portal. |
| **Modal Entry / Exit** | Fade in (`fade-in-0`) + Zoom in (`zoom-in-95 duration-150`) with backdrop blur. | Instant hard pop-in without animation or transition. | ❌ Modal transitions feel unpolished in Portal. |

---

## Dark Mode & Theme Audit

- **Admin Capability**: Full first-class dark mode support with automatic persistence, manual toggle (`Sun`/`Moon` icons in header and sidebar), and deep obsidian tokens (`#15171a` background, `#1d1f23` card, `#2b2f36` border, `#3eb083` accent).
- **Portal Capability**: Pure light mode only (`#f8fafc` background, `#ffffff` card). Portal has zero dark mode CSS variables or theme toggles.
- **Evaluation**: As a member-facing surface, Portal should inherit the platform token system from `@vibress/ui`. While Portal does not necessarily require a manual user theme toggle on every member screen, it **must** support the `--background`, `--card`, `--foreground`, `--border`, and `--primary` tokens so that if a publication enables dark mode or the member's OS prefers dark mode, Portal responds seamlessly with the canonical Vibress palette.

---

## Component Duplication & Drift Audit

| Component | Status | Recommendation |
|---|---|---|
| **Button** | Visual & Behavioral Duplicate | **CONSOLIDATE** into `@vibress/ui` (CVA variants). |
| **Input** | Visual Duplicate | **CONSOLIDATE** into `@vibress/ui`. |
| **Dialog / Modal** | Duplicated with Severe Drift & A11y Degradation | **CONSOLIDATE** into `@vibress/ui` (React portal modal). |
| **Card / CardHeader / CardTitle** | Visual Duplicate | **CONSOLIDATE** into `@vibress/ui`. |
| **Badge** | Missing in Portal | **CONSOLIDATE** into `@vibress/ui` and adopt in Portal. |
| **Avatar** | Missing in Portal | **CONSOLIDATE** into `@vibress/ui` and adopt in Portal. |
| **Alert / Banner** | Duplicate with Visual Drift | **CONSOLIDATE** into `@vibress/ui`. |
| **Spinner / Loader** | Missing in Portal | **CONSOLIDATE** into `@vibress/ui`. |
| **EmptyState** | Duplicate with Visual Drift | **CONSOLIDATE** into `@vibress/ui`. |
| **LanguageSwitcher** | Portal-Only implementation | **CONSOLIDATE** into `@vibress/ui` as a shared navigation utility. |
| **AdminShell / Sidebar / CommandPalette** | Admin-Specific | **KEEP ADMIN-ONLY**. |
| **SubscriptionSection / NewsletterPrefs** | Portal-Specific | **KEEP PORTAL-ONLY** (composed of shared `@vibress/ui` primitives). |

---

## Design System Ownership & Maturity

### 1. Monorepo Ownership Model
Currently:
```
packages/ui  ──(Not used)──>  apps/admin (Owns internal UI)
                           ──>  apps/portal (Owns inline styles)
```

Target Architecture:
```
                          packages/ui (Canonical Design System)
                               │
            ┌──────────────────┴──────────────────┐
            │                                     │
       apps/admin                            apps/portal
            │                                     │
    Composes UI Primitives               Composes UI Primitives
    + Admin-specific workflows           + Member-specific workflows
```

### 2. Maturity Level Classification
- **Current Classification**: **Level A — Independent Applications** (Admin and Portal do not share components, tokens, or styling systems; `@vibress/ui` is unused).
- **Target Classification**: **Level F — Full Vibress Design System** (Unified token pipeline, shared accessible component primitives in `packages/ui`, consistent RTL and responsive behaviors across all platform applications).

---

## Severity Classification of Audit Findings

### P0 — Broken / Blocking Usability or Accessibility
1. **P0-1: Un-portaled, Inaccessible Modals in Portal**: Change Email and Delete Account modals in `AccountPage.tsx` lack `role="dialog"`, `aria-modal="true"`, Escape key listeners, and keyboard focus traps (WCAG 2.1.1, 4.1.2).
2. **P0-2: Background Scroll Bleed during Modal Activation**: Opening a modal in Portal does not lock `document.body.style.overflow`, allowing underlying page content to scroll beneath the modal overlay.

### P1 — Major Visual / System Inconsistency
1. **P1-1: Primary Color Drift**: Portal uses electric blue (`#2563eb`) as its primary color, while Admin and the Vibress brand use slate/obsidian (`#0f172a` / `#15171a`).
2. **P1-2: Non-Existent Component Reuse**: Portal uses zero shared UI primitives, writing ad-hoc inline styles for every button, input, card, and modal.
3. **P1-3: Contrast Ratio Failures**: Portal hint text (`#94a3b8` on white = 2.54:1) and secondary button text (`#475569` on `#f1f5f9` = 3.8:1) violate WCAG AA 4.5:1 minimum contrast.
4. **P1-4: Touch Target Size Violations**: `LanguageSwitcher` and notification mark-read buttons are under 26px high, failing the 44px mobile touch target guideline.
5. **P1-5: Missing Focus-Visible Indicators**: Portal interactive elements do not define standardized high-contrast `:focus-visible` rings.

### P2 — Significant Design-System Drift
1. **P2-1: Iconography Absence & Inconsistency**: Admin standardizes on `lucide-react`; Portal uses raw unicode characters (`✓`) or no icons.
2. **P2-2: Missing Loading / Empty / Error State Primitives**: Portal renders raw text (`"Loading..."`, `"No members found"`) instead of standardized animated spinners and icon-driven empty state cards.
3. **P2-3: Layout Shift on Form Submissions**: Submit buttons in Portal change text length without fixed sizing, causing button width snapping during network calls.
4. **P2-4: Disparate Geometry & Heights**: Admin inputs and buttons use standard `h-8` (32px), `h-9` (36px), and `h-10` (40px) scales; Portal uses arbitrary padding resulting in 38px-42px heights.

### P3 — Minor Visual Inconsistency
1. **P3-1: Card Drop-Shadow Disparity**: Portal uses heavy `0 4px 16px rgba(0,0,0,0.08)` shadows vs. Admin's crisp `shadow-2xs`.
2. **P3-2: Card Padding on Mobile (320px)**: Portal cards use fixed 32px padding on all screens, cramping content on small mobile viewports.
3. **P3-3: Physical CSS Properties in RTL**: Portal uses physical margins/paddings (`margin: 0 0 12px`) instead of logical properties (`margin-block-end: 12px`).

### P4 — Enhancement / Future Improvement
1. **P4-1: Multi-Column Catalog Layout on Wide Screens**: `PlansPage` renders as a narrow 540px single column on desktop; could benefit from a responsive multi-column comparison grid on wide viewports.
2. **P4-2: Dark Mode Adaptation in Portal**: Enable Portal to automatically adapt to system dark mode using the shared `--background` and `--card` tokens.

---

## Target Architecture

```
                                  VIBRESS PLATFORM
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
      VIBRESS DESIGN SYSTEM                           VIBRESS THEME SYSTEM
      (Product Applications)                          (Public Websites)
                 │                                               │
          packages/ui                                  packages/theme-core
          ├── tokens.css (CSS Variables)               ├── Handlebars Engine
          ├── tailwind-preset.ts                       ├── SSR ViewModels
          ├── primitives/                              └── Theme Registry
          │   ├── Button, Input, FormField
          │   ├── Dialog, Dropdown, Popover
          │   ├── Card, Table, Tabs, Badge
          │   └── Avatar, Spinner, EmptyState
          └── utils/ (cn, formatters)
                 │
        ┌────────┴────────┐
        │                 │
   apps/admin        apps/portal
   (Publisher UX)    (Member UX)
```

### Shared Component Architecture (`packages/ui`)
- `packages/ui/src/primitives/button.tsx` (CVA Button & IconButton)
- `packages/ui/src/primitives/input.tsx` (ForwardRef text/email/number input)
- `packages/ui/src/primitives/card.tsx` (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- `packages/ui/src/primitives/dialog.tsx` (Portaled accessible modal)
- `packages/ui/src/primitives/badge.tsx` (CVA Badge with semantic variants)
- `packages/ui/src/primitives/avatar.tsx` (Avatar with fallback initials)
- `packages/ui/src/primitives/table.tsx` (Semantic HTML5 table suite)
- `packages/ui/src/primitives/tabs.tsx` (Context tabs suite)
- `packages/ui/src/primitives/spinner.tsx` (Animated spinner)
- `packages/ui/src/primitives/empty-state.tsx` (Icon + title + action layout)
- `packages/ui/src/primitives/alert.tsx` (Banner alert with icon)
- `packages/ui/src/primitives/language-switcher.tsx` (Accessible EN/AR switcher)
- `packages/ui/src/styles/theme.css` (Universal CSS variable tokens)

### Application-Specific Boundaries
- **Admin-Only**: `AdminShell`, `AppSidebar`, `CommandPalette`, `AnalyticsDashboard`, `PostEditor`, `PageEditor`, `MediaLibrary`, `SettingsHub`, `PermissionsGate`.
- **Portal-Only**: `SignInPage`, `CheckEmailPage`, `VerifyPage`, `AccountPage`, `PlansPage`, `SubscriptionSection`, `NewsletterPreferencesSection`, `NotificationsSection`.

---

## Page-by-Page Portal Audit & Parity Specification

### 1. `SignInPage` (`/portal/#/sign-in`)
- **Route**: `#/sign-in` (or default `/portal/`)
- **Layout**: Centered card layout on `--background`.
- **Components to Replace**:
  - Replace outer div with `<div className="min-h-screen w-full flex items-center justify-center bg-background p-4">`.
  - Replace raw card div with `<Card className="w-full max-w-md border border-border shadow-sm">`.
  - Replace title/subtitle with `<CardHeader className="text-center space-y-1">` and `<CardTitle>`, `<CardDescription>`.
  - Replace native `<input id="email">` with `<Input id="email" type="email" />`.
  - Replace submit button with `<Button type="submit" id="submit-sign-in" className="w-full" disabled={submitting}>`.
  - Replace error text with `<Alert variant="destructive">`.
  - Replace plain loading text with `<Spinner size="sm" /> {t("portal.sending")}`.
- **Contract Preservation**: Retain `#email`, `#submit-sign-in`, and text copy for Playwright test compatibility.

### 2. `CheckEmailPage` (`/portal/#/check-email`)
- **Route**: `#/check-email`
- **Layout**: Centered card layout on `--background`.
- **Components to Replace**:
  - Replace with `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
  - Replace resend button with `<Button variant="outline" className="w-full" onClick={handleResend}>`.
  - Replace "Back to sign in" link with `<Button variant="link" onClick={() => navigate("/sign-in")}>`.
  - Add `Mail` icon from `lucide-react`.

### 3. `VerifyPage` (`/portal/#/auth/verify?token=...`)
- **Route**: `#/auth/verify`
- **Layout**: Centered card layout on `--background`.
- **Components to Replace**:
  - `verifying` state: Render `<Card>` with centered `<Spinner size="lg" />` and `<p className="text-xs text-muted-foreground">{t("portal.verifying")}</p>`.
  - `success` state: Render `<Card>` with `<CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />`.
  - `error` state: Render `<Card>` with `<AlertCircle className="h-10 w-10 text-destructive mx-auto" />`, descriptive error copy, and `<Button id="verify-return-signin" onClick={() => navigate("/sign-in")}>`.

### 4. `AccountPage` (`/portal/#/account`)
- **Route**: `#/account`
- **Layout**: Centered card (`max-w-xl` / 576px) on `--background`.
- **Components to Replace**:
  - Profile Card: Use `Card`, `CardHeader`, `CardTitle`, `CardContent`.
  - Name input: Use `<Input id="name" />` and `<Button id="btn-save-profile">`.
  - Email Display: `<p id="member-email-display" className="text-sm font-mono text-muted-foreground">` with `<Button id="btn-open-change-email" variant="outline" size="sm">`.
  - Change Email Modal: Replace inline overlay with `<Dialog isOpen={showEmailModal} onClose={() => setShowEmailModal(false)} title={t("portal.change_email")}>`.
    - Form inside Dialog with `<Input id="new-email" />` and `<Button id="btn-confirm-email-change">`.
  - Delete Account Modal: Replace inline overlay with `<Dialog isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title={t("portal.delete_confirm_title")}>`.
    - Confirm button: `<Button id="btn-confirm-delete-account" variant="destructive">`.
  - Sign Out Button: `<Button id="btn-sign-out" variant="ghost" size="sm">`.

### 5. `PlansPage` (`/portal/#/plans`)
- **Route**: `#/plans` (aliases: `#/signup`, `#/sign-up`)
- **Layout**: Centered card or multi-column grid on `--background`.
- **Components to Replace**:
  - Wrap plans in `<Card>` with `<CardHeader>` for product info.
  - Plan rows: Render plan cards with `<Badge variant="success">` for trial days.
  - Checkout Button: `<Button onClick={() => startCheckout(plan)}>`.
  - Back to Account: `<Button variant="outline" onClick={() => navigate("/account")}>`.

---

## Visual Regression & Quality Assurance Strategy

### 1. Existing Monorepo Tooling Inspection
- Playwright E2E test suite located at `tests/e2e/`.
- Visual test harness located at `tests/e2e/visual/multilingual-visual-regression.test.ts`.
- Member portal flow certified in `tests/e2e/member-portal-flow.test.ts`.

### 2. Recommended Visual Regression Pipeline
- **Playwright Snapshot Testing**: Capture pixel-level baseline snapshots of all Portal pages (`/sign-in`, `/check-email`, `/auth/verify`, `/account`, `/plans`) across 3 viewports:
  - Mobile (390x844 — iPhone 14)
  - Tablet (768x1024 — iPad)
  - Desktop (1280x800 — Standard Display)
- **Dual Locale Coverage**: Capture snapshots in both `en` (LTR) and `ar` (RTL).
- **Dual Theme Coverage**: Capture snapshots in both Light (`:root`) and Dark (`.dark`).
- **Regression Gates**: Configure threshold `maxDiffPixelRatio: 0.01` (1% tolerance) in CI.

---

## Future Maintenance & Architecture Rules

1. **Zero Cross-App Imports**: `apps/portal` MUST NEVER import directly from `apps/admin`, and `apps/admin` MUST NEVER import from `apps/portal`.
2. **Canonical Primitive Layer**: All shared UI components (`Button`, `Input`, `Dialog`, `Card`, `Badge`, `Avatar`, `Table`, `Tabs`, `Spinner`, `EmptyState`, `Alert`) MUST reside in `packages/ui`.
3. **No Inline Hex Styling**: Applications MUST NOT define hardcoded hex color styles in components. All colors must resolve through Tailwind semantic tokens (e.g. `bg-card`, `text-foreground`, `border-border`).
4. **Strict Logical Property Rule**: All margins, paddings, borders, and position coordinates MUST use CSS logical properties (`start`, `end`, `inline`, `block`, `ps`, `pe`, `ms`, `me`) to guarantee seamless RTL support.
5. **Theme System Boundary**: Public website Handlebars themes in `packages/theme-core` must remain separate from the product application design system in `packages/ui`.
6. **DOM Test ID Preservation**: Any component refactoring must preserve existing test IDs (`#email`, `#submit-sign-in`, `#btn-open-change-email`, `#modal-change-email`, `#btn-confirm-email-change`, `#btn-open-delete-account`, `#modal-delete-account`, `#btn-confirm-delete-account`, `#member-email-display`, `portal-lang-en`, `portal-lang-ar`).

---

## Final Recommendations

1. **Elevate `packages/ui`**: Upgrade `packages/ui` to house the canonical Vibress design system tokens, Tailwind v4 configuration, and accessible CVA primitives.
2. **Standardize Tailwind v4 in Portal**: Configure `@tailwindcss/vite` in `apps/portal/vite.config.ts` and import the universal theme CSS.
3. **Migrate Portal Page by Page**: Sequentially refactor Portal pages (`SignInPage` -> `CheckEmailPage` -> `VerifyPage` -> `AccountPage` -> `PlansPage`) to use `@vibress/ui` primitives while preserving all DOM contracts.
4. **Implement Portaled Accessible Dialogs**: Replace Portal's ad-hoc modals with the shared `Dialog` primitive to resolve P0 accessibility violations.
5. **Harmonize Primary Palette**: Adopt the Vibress slate/obsidian palette as the primary token across both Admin and Portal for true product brand parity.
