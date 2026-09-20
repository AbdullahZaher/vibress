# Vibress — Portal & Admin Design System Migration Plan
**Implementation-Ready Engineering Roadmap for Platform Visual Parity**

---

## 1. Overview & Objectives

This migration plan outlines the precise, phased execution strategy to bring **`apps/portal`** into visual, architectural, token, responsive, and accessibility parity with **`apps/admin`**, powered by the shared platform package **`packages/ui`**.

### Guiding Principles
1. **Design System vs. Application Workflows**:
   - **`packages/ui`** is the single source of truth for design tokens and accessible UI primitives.
   - **`apps/admin`** composes these primitives for editorial and management workflows.
   - **`apps/portal`** composes these primitives for member authentication, account self-service, and subscription workflows.
   - **`packages/theme-core`** remains strictly decoupled for public site Handlebars themes.
2. **Zero Regressions on Existing E2E Contracts**:
   - All DOM IDs (`#email`, `#submit-sign-in`, `#btn-open-change-email`, `#modal-change-email`, `#btn-confirm-email-change`, `#btn-open-delete-account`, `#modal-delete-account`, `#btn-confirm-delete-account`, `#member-email-display`, `portal-lang-en`, `portal-lang-ar`, etc.) and test attributes must remain intact.
3. **Phased, Atomic Delivery**:
   - Each phase is independently testable, reversible, and verified against Playwright E2E suites.

---

## 2. Target Package Architecture

```
packages/
└── ui/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                      # Barrel export of all primitives & utils
        ├── utils.ts                      # Canonical cn (clsx + tailwind-merge)
        ├── styles/
        │   ├── theme.css                 # CSS variables (--background, --card, --primary, etc.)
        │   └── globals.css               # Tailwind v4 import + @theme mappings + base resets
        └── primitives/
            ├── button.tsx                # CVA Button & IconButton
            ├── input.tsx                 # ForwardRef accessible Input
            ├── card.tsx                  # Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
            ├── dialog.tsx                # Portaled, keyboard-accessible Dialog
            ├── badge.tsx                 # Semantic CVA Badge
            ├── avatar.tsx                # Initials/Image Avatar
            ├── table.tsx                 # Semantic HTML5 Table Suite
            ├── tabs.tsx                  # Context-driven Tabs
            ├── spinner.tsx               # Animated Lucide/CSS Spinner
            ├── alert.tsx                 # Semantic banner Alert with icons
            ├── empty-state.tsx           # Icon + Title + Description EmptyState
            ├── label.tsx                 # Accessible Form Label
            ├── checkbox.tsx              # Styled Accessible Checkbox
            └── language-switcher.tsx     # Standardized EN/AR language switcher
```

---

## 3. Detailed Migration Phases

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   PHASE 1    │ ──> │   PHASE 2    │ ──> │   PHASE 3    │ ──> │   PHASE 4    │
│  Package &   │     │  Component   │     │   Portal     │     │    Admin     │
│ Tokens Setup │     │ Primitives   │     │  Migration   │     │  Alignment   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
        │
        └──────────────────────────────────────────────┐
                                                       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   PHASE 7    │ <── │   PHASE 6    │ <── │   PHASE 5    │
│ Documentation│     │Visual & E2E  │     │ A11y & RTL   │
│ & Release    │     │ Certification│     │ Verification │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

### Phase 1: Establish Canonical Design Tokens & Tooling in `packages/ui`

#### 1.1 Update `packages/ui/package.json`
Add necessary dependencies for Tailwind v4 and CVA primitives:
```json
{
  "name": "@vibress/ui",
  "version": "1.1.0",
  "license": "MIT",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.30.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^3.6.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.5.3"
  }
}
```

#### 1.2 Implement Canonical `cn` Utility (`packages/ui/src/utils.ts`)
```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

#### 1.3 Export Canonical Theme CSS (`packages/ui/src/styles/theme.css`)
Extract the complete semantic tokens from `apps/admin/src/styles/globals.css`:
- Light mode tokens (`:root`)
- Dark mode tokens (`.dark`)
- Status colors (`published`, `draft`, `scheduled`, `review`, `danger`)
- Motion reduction media queries
- RTL typography line-heights and letter-spacing

---

### Phase 2: Extract & Build Shared UI Primitives in `packages/ui`

Move and standardize the battle-tested primitives from `apps/admin/src/components/ui/` into `packages/ui/src/primitives/`:

1. **`Button`** (`button.tsx`):
   - CVA variants: `default` (slate/obsidian), `destructive`, `outline`, `secondary`, `ghost`, `link`.
   - Sizes: `default` (h-9), `sm` (h-8), `xs` (h-7), `lg` (h-10), `icon` (h-9 w-9), `icon-sm` (h-7 w-7).
   - Micro-interaction: `active:scale-[0.99]`, focus ring: `focus-visible:ring-2 focus-visible:ring-ring`.

2. **`Input`** (`input.tsx`):
   - ForwardRef, `h-9`, `border-border/70`, `bg-background`, `shadow-2xs`, `focus-visible:ring-ring`.

3. **`Dialog`** (`dialog.tsx`):
   - Portaled to `document.body` via `createPortal`.
   - `role="dialog"`, `aria-modal="true"`, backdrop blur (`bg-black/60 backdrop-blur-xs`).
   - Animation: `animate-in fade-in-0 zoom-in-95 duration-150`.
   - Keyboard: Escape key listener, body scroll lock (`overflow: hidden`).
   - Close icon button: `absolute top-4 end-4` (RTL logical coordinate).

4. **`Card`** (`card.tsx`):
   - `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.

5. **`Badge`** (`badge.tsx`):
   - Variants: `default`, `secondary`, `published`, `draft`, `scheduled`, `success`, `warning`, `review`, `info`, `destructive`, `outline`.

6. **`Avatar`** (`avatar.tsx`):
   - Fallback initials generator, image error boundary, sizes `sm`, `md`, `lg`.

7. **`Spinner`** (`spinner.tsx`):
   - Accessible animated loader with `aria-live="polite"` and `role="status"`.

8. **`Alert`** (`alert.tsx`):
   - Semantic alert banner with variants `default`, `destructive`, `success`, `warning`, `info`.

9. **`EmptyState`** (`empty-state.tsx`):
   - Centered icon, title, description, and action button slots.

10. **`LanguageSwitcher`** (`language-switcher.tsx`):
    - Accessible EN / AR switcher buttons meeting the 32px-36px touch target requirement.

---

### Phase 3: Configure Portal Tooling & Global Styles

#### 3.1 Update `apps/portal/package.json`
Add `@tailwindcss/vite`, `tailwindcss`, `clsx`, `tailwind-merge`, `lucide-react`, and `@vibress/ui`:
```json
{
  "name": "@vibress/portal",
  "dependencies": {
    "@vibress/i18n": "workspace:*",
    "@vibress/ui": "workspace:*",
    "lucide-react": "^1.30.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.5.3",
    "vite": "^8.2.1"
  }
}
```

#### 3.2 Update `apps/portal/vite.config.ts`
Enable `@tailwindcss/vite` plugin:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/portal/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: process.env.PORTAL_PORT ? parseInt(process.env.PORTAL_PORT) : 7781,
    host: "0.0.0.0",
  },
});
```

#### 3.3 Create `apps/portal/src/styles/globals.css`
Import `@import "@vibress/ui/styles/globals.css";` to bind tokens and Tailwind resets.

---

### Phase 4: Page-by-Page Migration of `apps/portal`

#### 4.1 Migrate `SignInPage.tsx`
- Replace raw div container with `min-h-screen w-full flex items-center justify-center bg-background p-4`.
- Replace inline card with `<Card className="w-full max-w-md border border-border shadow-sm">`.
- Use `<CardHeader>`, `<CardTitle>`, `<CardDescription>`.
- Use `<Input id="email" type="email" />`.
- Use `<Button type="submit" id="submit-sign-in" className="w-full" disabled={submitting}>`.
  - Include `<Spinner size="sm" />` when `submitting` is true.
- Replace raw error text with `<Alert variant="destructive">`.
- Preserve IDs: `#email`, `#submit-sign-in`.

#### 4.2 Migrate `CheckEmailPage.tsx`
- Use `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardDescription>`, `<CardContent>`.
- Add `<Mail className="h-6 w-6 text-primary mx-auto mb-2" />`.
- Use `<Input type="email" />`.
- Use `<Button variant="outline" className="w-full" onClick={handleResend}>`.
- Use `<Button variant="link" onClick={() => navigate("/sign-in")}>`.

#### 4.3 Migrate `VerifyPage.tsx`
- Verifying State: `<Card>` with centered `<Spinner size="lg" />` and `<p className="text-xs text-muted-foreground">{t("portal.verifying")}</p>`.
- Success State: `<Card>` with `<CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />`.
- Error State: `<Card>` with `<AlertCircle className="h-10 w-10 text-destructive mx-auto" />`, error description, and `<Button id="verify-return-signin">`.

#### 4.4 Migrate `AccountPage.tsx`
- Layout: Centered `<div className="min-h-screen w-full flex items-center justify-center bg-background p-4 sm:p-6">` with `<Card className="w-full max-w-xl border border-border shadow-sm">`.
- Profile Section:
  - Email row: `<span id="member-email-display" className="text-xs font-mono text-muted-foreground">` + `<Button id="btn-open-change-email" variant="outline" size="sm">`.
  - Name form: `<Input id="name" />` + `<Button id="btn-save-profile" type="submit">`.
  - Success banner: `<Alert variant="success">{message}</Alert>`.
- Change Email Modal:
  - Replace inline overlay with `<Dialog isOpen={showEmailModal} onClose={() => setShowEmailModal(false)} title={t("portal.change_email")}>`.
  - Form inside Dialog: `<Input id="new-email" />` + `<Button id="btn-confirm-email-change">`.
  - Status alert: `<p id="email-change-status" role="status">` inside `<Alert variant="success">`.
- Delete Account Modal:
  - Replace inline overlay with `<Dialog isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title={t("portal.delete_confirm_title")}>`.
  - Confirm button: `<Button id="btn-confirm-delete-account" variant="destructive">`.
- Sign Out Button: `<Button id="btn-sign-out" variant="ghost" size="sm">`.

#### 4.5 Migrate Child Sections in `apps/portal/src/components/`
1. **`SubscriptionSection.tsx`**:
   - Replace bordered divs with `<Card className="p-4 border-border/70">`.
   - Use `<Badge variant="published">` or `<Badge variant="warning">` for subscription status.
   - Use `<Button id="btn-view-plans" size="sm">` for Upgrade, Resume, Manage actions.
   - Use `<Button variant="outline" size="sm" className="text-destructive border-destructive/30">` for Cancel.
2. **`NewsletterPreferencesSection.tsx`**:
   - Replace custom checkbox with styled `<Checkbox checked={item.subscribed} onChange={...} />`.
   - Use `<Badge variant="outline">` for subscription status.
   - Replace empty message with `<EmptyState title={t("portal.no_newsletters")} />`.
3. **`NotificationsSection.tsx`**:
   - Use `<Badge variant="destructive">` for unread counter badge.
   - Replace `✓` button with `<Button size="icon-sm" variant="ghost" aria-label="Mark read"><Check className="h-3.5 w-3.5" /></Button>`.
   - Replace empty message with `<EmptyState title={t("portal.no_notifications")} />`.

#### 4.6 Migrate `PlansPage.tsx`
- Render product and plan cards using `<Card>` with `<CardHeader>`, `<CardTitle>`, `<CardContent>`.
- Use `<Badge variant="success">` for trial day badges.
- Use `<Button size="sm" onClick={() => startCheckout(plan)}>` for plan selection.
- Use `<Button variant="outline" onClick={() => navigate("/account")}>` for account return.

---

### Phase 5: Align `apps/admin` with `@vibress/ui`

1. Update `apps/admin` imports from local `./ui/*` to `@vibress/ui`.
2. Remove duplicate component definitions in `apps/admin/src/components/ui/` once verified.
3. Validate that Admin continues to build cleanly with zero type errors.

---

### Phase 6: Accessibility & RTL Parity Verification

1. **Accessibility (WCAG 2.2 AA) Audit**:
   - Verify all modal dialogs pass focus trapping and Escape key dismissal tests.
   - Verify color contrast ratios for all text tokens against light and dark backgrounds (> 4.5:1 for normal text, > 3:1 for large text).
   - Verify all interactive controls have minimum 32px height on desktop and 44px on mobile.
   - Verify all input fields have explicit `:focus-visible` ring outlines.
2. **RTL Verification**:
   - Toggle language to Arabic (`ar`).
   - Confirm layout flips correctly via CSS logical properties (`start`, `end`, `ps`, `pe`, `ms`, `me`).
   - Verify Arabic line-heights and typography rendering in both Admin and Portal.

---

### Phase 7: Visual Regression & E2E Certification

1. **Run Playwright E2E Suite**:
   ```bash
   pnpm test:e2e tests/e2e/member-portal-flow.test.ts
   ```
2. **Visual Regression Snapshot Suite**:
   - Generate pixel-by-pixel snapshot comparisons for `/portal/#/sign-in`, `/portal/#/check-email`, `/portal/#/account`, `/portal/#/plans` across 390px, 768px, and 1280px viewports in both LTR and RTL.
3. **Full Monorepo Verification**:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

---

## 4. Test Strategy & DOM Contract Preservation Matrix

| Test Identifier / Selector | Target Component | Action | Verification Rule |
|---|---|---|---|
| `#email` | `SignInPage` | Input | Must accept email string and trigger validation |
| `button[type="submit"]` / `#submit-sign-in` | `SignInPage` | Button | Must submit magic link request |
| `#member-email-display` | `AccountPage` | Text Container | Must render current member's verified email |
| `portal-lang-en` | `LanguageSwitcher` | Button | Switches locale to `en` (dir="ltr", lang="en") |
| `portal-lang-ar` | `LanguageSwitcher` | Button | Switches locale to `ar` (dir="rtl", lang="ar") |
| `#newsletter-preferences-section` | `NewsletterPreferencesSection` | Container | Must render newsletter toggle list |
| `#newsletter-pref-{key}` | `NewsletterPreferencesSection` | Row | Must toggle subscription preference |
| `#btn-open-change-email` | `AccountPage` | Button | Opens change email modal |
| `#modal-change-email` | `AccountPage` | Dialog | Must become visible on click |
| `#new-email` | `AccountPage` | Input | Input for new email address |
| `#btn-confirm-email-change` | `AccountPage` | Button | Submits email change request |
| `#email-change-status` | `AccountPage` | Alert / Text | Displays link sent notification |
| `#btn-open-delete-account` | `AccountPage` | Button | Opens deletion confirmation modal |
| `#modal-delete-account` | `AccountPage` | Dialog | Must become visible on click |
| `#btn-confirm-delete-account` | `AccountPage` | Button | Executes member self-deletion |
| `#btn-view-plans` | `SubscriptionSection` | Button | Navigates to `#/plans` |
| `#btn-save-profile` | `AccountPage` | Button | Submits member name update |
| `#btn-sign-out` | `AccountPage` | Button | Clears auth session and redirects |
| `#account-signin-redirect` | `AccountPage` | Button | Redirects expired session to sign-in |
| `#verify-return-signin` | `VerifyPage` | Button | Returns to sign-in on token error |

---

## 5. Acceptance Criteria & Definition of Done

### Acceptance Criteria
- [ ] **Design Token Unification**: Both `apps/admin` and `apps/portal` consume identical CSS variable tokens from `@vibress/ui`.
- [ ] **Visual Parity**: Portal elements (cards, inputs, buttons, badges, dialogs, typography) visibly belong to the same product family as Admin.
- [ ] **Accessibility Compliance**: All modals meet WCAG 2.2 AA (ARIA attributes, keyboard trap, Escape dismissal); all text meets 4.5:1 contrast ratio; all focus rings are visible.
- [ ] **RTL Consistency**: RTL direction toggles seamlessly in Portal with logical CSS properties and tailored line-heights.
- [ ] **E2E Test Stability**: 100% pass rate on `tests/e2e/member-portal-flow.test.ts` and all existing monorepo E2E suites.
- [ ] **Zero Cross-App Coupling**: `apps/portal` does not import from `apps/admin`, and `apps/admin` does not import from `apps/portal`.
- [ ] **Decoupled Themes**: `packages/theme-core` remains untouched and decoupled from the application design system.

### Definition of Done
1. `@vibress/ui` contains all extracted, fully typed component primitives with unit test coverage.
2. `apps/portal` has zero inline `React.CSSProperties` style objects.
3. `apps/admin` consumes shared primitives from `@vibress/ui`.
4. `pnpm typecheck` passes with zero errors across all packages and apps.
5. `pnpm lint` passes with zero warnings.
6. `pnpm test` and `pnpm test:e2e` pass with 100% green tests.
