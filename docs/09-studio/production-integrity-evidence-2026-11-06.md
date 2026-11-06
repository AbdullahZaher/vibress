# Studio host integrity evidence — 2026-11-06

Implementation source: `cb0be3f03460cc57143e43db093c523e27b4cf0d`.
Delivery: [PR #130](https://github.com/AbdullahZaher/vibress/pull/130),
`codex/studio-host-integrity`, based on `c641ed063f79ceb109988ec19692338a319c8b96`.

The focused changes preserve historical roots, envelope/editor metadata and
opaque card data; use explicit replacement and ordered metadata contracts;
retain mounted drafts on rejected input; reject registered forward fields and
unsupported numeric alignment before Lexical can discard them; preflight
accessors before serialization; and guard post/page requests across document
switches. See [content-format](content-format.md) for the host-facing contract.

Regression evidence:89 tests in16 focused files pass. Four real authenticated
API/PostgreSQL persistence cases and fourteen existing WebSocket/Yjs/Redis cases
pass on explicitly disposable synthetic services. Core/serializer/React builds,
admin typecheck, scoped lint, explicit-any and production audit pass. Local Nx
module-boundary lint warns that no cached graph is available; full CI lint is a
separate gate. Disposable services were stopped after final verification.

Independent review reproduced and prompted corrections for page ownership,
opaque metadata, unsafe accessor evaluation, registered forward fields and
numeric alignment. Its final source review found no unresolved actionable
correctness finding within those corrections, with broader release gates open.

A real mounted Lexical/Yjs probe confirms that database restore plus remount
cannot replace retained collaborative content. Default UI restoration is gated
before confirmation or HTTP mutation, with disabled controls and a visible
Arabic/English explanation. This does not fix the REST endpoint or coordinate
other clients. An explicit mount-time noncollaborative mode is not a workaround
for active or retained CRDT rooms. Coordinated restoration remains release-blocked.

Main's inherited translation/public-content failures and media browser failures
remain outside this focused branch. The initial PR CI also exposed a shared
seeded-owner login fixture; the persistence suite now creates a dedicated
synthetic account and passes locally. Inspect the current PR checks for final
CI; a local pass is not a claim that the whole host is green.

[The cross-repository program report](https://github.com/AbdullahZaher/vibress-studio/blob/codex/studio-package-contract/docs/audits/world-class-editor-program-2026-11-06.md)
records the findings matrix, evidence, outstanding acceptance and release gates.
No merge, publication, deployment, live-data change or organizational approval
was performed. Status: **NOT READY FOR PRODUCTION**.
