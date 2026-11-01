# React State Management — Vibress Engineering Standard

**Status:** Engineering guidance for new and modified React code.  
**Scope:** `apps/admin`, `apps/portal` and React-based Vibress-owned Studio integration UI.  
**Reviewed:** 2026-11-01.  
**Companion documents:** [Upstream Markdown reference notes](react-state-reference-notes.md) | [Review checklist](react-state-review-checklist.md).

## Purpose and authority

This document translates React principles into conventions for a production, self-hostable, multilingual, multi-publication CMS. Follow `AGENT.md`, established application patterns and security requirements. Do not introduce new state libraries, mass refactors or breaking contracts merely to satisfy this guidance. **MUST** denotes correctness/security requirements; **SHOULD** is a strong default; **CONSIDER** is context-dependent. This document does not claim that its rules are all enforced by current lint configuration.

## 1. Choose the correct owner of state

| Data | Preferred owner | Rule |
| --- | --- | --- |
| Dialog open/closed, tab, temporary selection, unsaved input | Local `useState` or existing form pattern | Keep ownership close to actual consumers. |
| Complex, coupled transitions | `useReducer` or established state machine | Avoid contradictory flags and impossible states. |
| API-loaded plugins, themes, members and request lifecycle | App's existing server-state/query layer | `apps/admin` has TanStack Query; do not assume `apps/portal` has it. |
| Shareable navigation, filters or pagination | Established router / URL | Preserve reloadable URL semantics. |
| Values computed from props or state | Calculate during render | Memoize only when supported by performance/identity needs. |
| Mutable handles that do not affect UI | `useRef` | Do not rerender for non-rendering values. |
| Permissions, sessions, authoritative publication ownership and plugin admission | Server/API/domain layer | Client state is not authorization or tenant isolation. |

## 2. Hooks and state update invariants (MUST)

- Call Hooks at the top level of function components or custom Hooks, not inside loops, conditions, event handlers, effects, or nested functions. Keep call order stable, including before conditional early returns.
- Treat props and state as immutable snapshots. Use array methods and object copies, not in-place mutation.
- Use functional updaters when the next value depends on prior state; React batches queued updates and a setter does not synchronously change the current render's variable.
- Never unconditionally update state during rendering. Do not set state in an Effect simply to mirror data already available during render.
- Keep initializers, reducers and updater functions pure. Prefer a lazy initializer for costly initial computation; Strict Mode may invoke it twice during development.
- Retain strict TypeScript and existing project constraints; avoid `any`, unsafe casts and lint suppressions.

```tsx
const [isOpen, setIsOpen] = useState(false);

function toggleDetails() {
  setIsOpen(previous => !previous);
}

setPlugins(previous =>
  previous.map(plugin =>
    plugin.id === targetId
      ? { ...plugin, isSelected: true }
      : plugin
  )
);
```

The example updates **local UI selection**, not plugin activation or server admission.

## 3. Minimize redundant or inconsistent state (SHOULD)

- Derive filtered arrays, display labels, aggregate counts, and other cheap values from existing data instead of synchronizing another state variable.
- Avoid combinations such as three independent `isLoading`, `isSuccess` and `isError` booleans when a mutually exclusive union represents one operation.
- Initialize from props only for a deliberate editable draft with documented reset/save behavior; do not accidentally mirror new server props over unsaved edits.
- Split independent state. Group related values when maintaining a meaningful invariant.
- Lift state only to the nearest shared owner; avoid unnecessarily globalizing transient UI state.
- Use `useMemo` and `useCallback` when they resolve a measured issue or concrete referential-identity requirement, not automatically.

```tsx
type SaveStatus = "idle" | "saving" | "success" | "error";
const [status, setStatus] = useState<SaveStatus>("idle");

const [search, setSearch] = useState("");
const visiblePlugins = plugins.filter(plugin =>
  plugin.name.toLowerCase().includes(search.toLowerCase())
);
```

The string filter illustrates derived state only. Production multilingual search must follow the app's locale-aware search conventions.

## 4. Server state and publication security (MUST)

- Reuse each app's existing API client and query strategy. UI must not bypass API contracts or query the database directly.
- Authentication, `requirePermission`, publication/workspace identity, membership and admission decisions remain server-authoritative. A client-supplied ID or `useState` flag does not establish permission.
- Build query identities from every input affecting returned data: authenticated publication context, resource ID, filters and locale if data varies by locale. **Correct keys reduce UI leakage but cannot enforce isolation.**
- On logout, identity change or publication switch, follow existing cache invalidation/reset conventions; avoid showing stale cross-context results. Define what happens to pending unsaved drafts.
- Never persist credentials, bearer tokens, private member data or capability grants into broad local UI state/storage for convenience.
- Reflect API-confirmed outcomes. Handle pending, empty, validation errors, 401/403, 404, conflict, provider errors and retry appropriately. After a successful mutation, update/invalidate affected queries according to existing patterns.
- Only implement optimistic updates when rollback, conflict handling and permission changes are correct. Optimistic UI is not a persistence guarantee.
- Runtime validation and error contracts remain the responsibility of existing API/schema layers.

**Current dependency boundary:** `apps/admin` declares `@tanstack/react-query`. `apps/portal` declares React but no TanStack Query; new dependencies require explicit review.

## 5. Effects and asynchronous work

- Effects are for external synchronization, not derived render-time computation.
- Use established query/fetch patterns. When handling async work in a component, abort or ignore superseded responses and clean up subscriptions. Prevent a slow old request from overwriting a newer resource selection.
- Do not trigger network mutations during render. Keep user actions and side effects in approved API/domain flows.
- Respect Effect dependencies rather than hiding dependency errors; inspect ownership and identity if an Effect loops.
- Preserve retry limits and observable error states. Do not hide failed writes or create unbounded retries.

## 6. Lifetime and unsaved drafts

React ties local state to component identity and position. A deliberate `key` may reset a form when switching entities:

```tsx
<PluginSettingsForm key={plugin.id} plugin={plugin} />
```

**Important:** This also discards dirty local state. Introduce draft-preservation or a confirmation path where needed. Never silently drop editor work when switching posts, plugins, themes, publications or routes. Preserve existing persisted-content and Studio contracts.

## 7. i18n/RTL and accessibility (MUST)

- Support Arabic, RTL, Unicode, mixed-direction input, long translations and locale policy; do not hard-code English or LTR assumptions into state logic.
- Preserve focus management, keyboard control, accessible labels, meaningful disabled/pending behavior, validation feedback and screen-reader semantics in dialogs/forms.
- Distinguish a merely toggled UI indicator from a confirmed server operation; report real error and retry paths accessibly.

## 8. Required review for implementation changes

Choose focused tests for relevant behavior: initial state, queued updates, immutable updates, fast entity/publication switching, stale responses, cache identity, logout cleanup, dirty drafts, validation/authz/wrong-publication, pending/success/error/conflict/retry, RTL and keyboard/focus interaction. Review compatibility for public routes, themes, plugins, SDKs, stored documents and self-hosted upgrades when touched.

Use the [review checklist](react-state-review-checklist.md). Documentation changes alone do not certify application behavior or passing tests.

## Sources and maintenance

This is Vibress-authored original guidance. The [annotated references](react-state-reference-notes.md) preserve verified links to source Markdown and research, not full third-party copies. Check the relevant React, TanStack Query, TypeScript and lint versions before importing guidance or enabling new enforcement.
