# React State Management — Annotated Source Markdown

**Reviewed:** 2026-11-01.  
**Primary policy:** [Vibress React State Management Standard](react-state-management.md).  
**Usage:** The following links point to the **original Markdown source files** in maintained upstream repositories. These annotations are written for Vibress and kept locally; full upstream documents are not copied, avoiding unnecessary duplication and out-of-date vendored references. Verify source changes and versions when implementing rules.

## React — upstream Markdown

| Markdown file | Why it matters |
| --- | --- |
| [useState API reference](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useState.md) | State snapshot, setter queue, functional updates, lazy initializers and caveats. |
| [Rules of Hooks](https://github.com/reactjs/react.dev/blob/main/src/content/reference/rules/rules-of-hooks.md) | Stable top-level Hook calls. |
| [Choosing the State Structure](https://github.com/reactjs/react.dev/blob/main/src/content/learn/choosing-the-state-structure.md) | Related, contradictory, duplicated and redundant state. |
| [Queueing a Series of State Updates](https://github.com/reactjs/react.dev/blob/main/src/content/learn/queueing-a-series-of-state-updates.md) | Batching and queued functional updates. |
| [Updating Objects in State](https://github.com/reactjs/react.dev/blob/main/src/content/learn/updating-objects-in-state.md) | Immutable object changes. |
| [Updating Arrays in State](https://github.com/reactjs/react.dev/blob/main/src/content/learn/updating-arrays-in-state.md) | Immutable array transformations. |
| [You Might Not Need an Effect](https://github.com/reactjs/react.dev/blob/main/src/content/learn/you-might-not-need-an-effect.md) | Derived state and avoiding synchronization Effects. |
| [Preserving and Resetting State](https://github.com/reactjs/react.dev/blob/main/src/content/learn/preserving-and-resetting-state.md) | State identity and intentional reset with keys. |
| [State as a Snapshot](https://github.com/reactjs/react.dev/blob/main/src/content/learn/state-as-a-snapshot.md) | Setter timing and the render snapshot. |
| [Extracting State Logic into a Reducer](https://github.com/reactjs/react.dev/blob/main/src/content/learn/extracting-state-logic-into-a-reducer.md) | Complex local state transitions. |
| [Thinking in React](https://github.com/reactjs/react.dev/blob/main/src/content/learn/thinking-in-react.md) | Minimal state and correct ownership. |

## React Hooks ESLint rules — upstream Markdown

| Markdown file | Why it matters |
| --- | --- |
| [Immutability](https://github.com/reactjs/react.dev/blob/main/src/content/reference/eslint-plugin-react-hooks/lints/immutability.md) | Detects mutations of props and state. |
| [set-state-in-effect](https://github.com/reactjs/react.dev/blob/main/src/content/reference/eslint-plugin-react-hooks/lints/set-state-in-effect.md) | Review unnecessary synchronous state updates in Effects. |
| [set-state-in-render](https://github.com/reactjs/react.dev/blob/main/src/content/reference/eslint-plugin-react-hooks/lints/set-state-in-render.md) | Review unconditional render-phase state updates. |

## TanStack Query — upstream Markdown

| Markdown file | Why it matters |
| --- | --- |
| [Queries](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/queries.md) | Pending/error/success and fetching lifecycle. |
| [Important Defaults](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/important-defaults.md) | Cache staleness, refetch and retry behavior. |
| [Query Invalidation](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/query-invalidation.md) | Refresh cached data after mutations. |

## Academic research and related Markdown

- Ferreira and Valente (2023), [Detecting code smells in React-based Web apps](https://doi.org/10.1016/j.infsof.2022.107111), *Information and Software Technology*, 155, 107111 — peer-reviewed catalog of React maintainability smells, not prescriptive app security guidance.
- [React Code Smells — README.md](https://github.com/fabiosferreira/React-Code-Smells/blob/main/README.md) — linked catalog behind the research.
- [ReactSniffer — README.md](https://github.com/fabiosferreira/reactsniffer/blob/main/README.md) — historical research prototype; do not install as a production gate without a compatibility assessment.
- Ferreira (2023), [Assisting JavaScript Front-End Developers in Maintaining and Evolving React-Based Applications](https://repositorio.ufmg.br/handle/1843/59120) — doctoral thesis about React maintenance and refactoring.

## Version and enforcement caveats

- `apps/admin` currently declares React 18 and TanStack Query 5; `apps/portal` declares React 18 without TanStack Query. Do not silently impose admin dependencies on other apps.
- The ESLint rule reference links describe potential static checks. They **do not establish that those rules are installed or enabled in Vibress**.
- Research code smells are review heuristics, not automatic evidence that an implementation is wrong.
- No copied upstream documentation or paper content is licensed or maintained here. Source authors retain ownership; use the links for their original text.

When updating the [standard](react-state-management.md), recheck the linked references and update the [checklist](react-state-review-checklist.md) together.
