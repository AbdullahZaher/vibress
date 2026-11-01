# React State Management — Vibress Review Checklist

**Policy:** [React State Management Standard](react-state-management.md).  
**Source files:** [Annotated Markdown notes](react-state-reference-notes.md).

Use only the applicable checks in a scoped React change. `AGENT.md` and existing security/compatibility requirements remain authoritative.

## State correctness and maintainability

- [ ] Hooks have valid top-level call sites with a stable call order.
- [ ] Props and state remain immutable, with strict TypeScript types and no new unsafe casts.
- [ ] Previous-state-dependent updates use functional setters.
- [ ] Cheap derived values are calculated instead of stored as redundant state.
- [ ] Contradictory states are impossible or explicitly prevented; complex transitions have a justified reducer/state machine.
- [ ] State ownership is local unless genuine sharing or URL semantics require otherwise.
- [ ] Effects synchronize with external systems only where needed; dependencies, cancellation and stale responses are handled.
- [ ] Using `key` or route changes does not silently discard dirty forms.

## API, cache and security

- [ ] Existing API/query architecture is reused without new unreviewed dependencies.
- [ ] Permission, session and publication isolation checks remain server authoritative.
- [ ] Query identity includes relevant publication, resource, filter and locale inputs.
- [ ] Logout, identity/publication switching and invalidation avoid stale cross-context display.
- [ ] Network mutations handle pending, success, error, conflict, rejection, retry and rollback if optimistic.
- [ ] Sensitive information is not unnecessarily placed in persistent/broadly shared client state.

## Platform UX and compatibility

- [ ] Keyboard, focus, labels and accessible error feedback work.
- [ ] Arabic, RTL, mixed-direction content and long translated strings are supported.
- [ ] Existing URLs, plugins, themes, SDKs, API contracts, persisted content and self-hosted upgrades remain compatible where affected.
- [ ] Unit/component/integration tests cover applicable races, error paths, permission and wrong-publication cases.
- [ ] Relevant checks were actually run; the report distinguishes observed results from unverified expectations.

**For documentation-only changes:** Verify accurate links, Markdown, scope and internal cross-references. Do not claim UI tests were executed.
