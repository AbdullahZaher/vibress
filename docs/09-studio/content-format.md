# Vibress Studio Content Format

## Canonical source

The canonical source of editable content is a versioned structured document, not generated HTML.

Example:

```json
{
  "schema": "vibress-studio",
  "version": 1,
  "root": {
    "type": "root",
    "children": [
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Hello Vibress"
          }
        ]
      }
    ]
  }
}
```

## Output model

```text
Studio Document
      │
      ├── Web HTML
      ├── Email HTML
      ├── Plain Text
      ├── Markdown
      ├── RSS-safe output
      └── API JSON
```

## Versioning

Every canonical document requires an explicit format version.

Migration functions should support:

```text
v1 → v2
v2 → v3
```

Old content must remain renderable.

### Historical root recovery

Older records can contain `{ "version": 1, "root": {} }` or a root with a
`children` array but no `type`. `migrateDocument` recognizes these shapes and
adds only the missing structural fields. An empty object becomes
`{ "type": "root", "children": [] }`; existing children and root metadata are
retained. Input objects are not mutated and database rows are not rewritten by
loading them. The editor adapts an empty root to an editable paragraph internally.

Direct `validateStudioDocument` remains strict. An explicit non-root type,
invalid children or an incomplete root containing other data raises
`StudioMigrationError` with the original input for recovery. Post and page
editors then block replacement saves and offer the existing recovery route.
Resource limits are checked again after adding structural fields. Foreign
schemas and unsupported versions do not use this compatibility repair.

Run the focused migration, editor-load, recovery and autosave regressions without
database seeding:

```sh
pnpm exec vitest run --config vitest.studio-recovery.config.ts
```

## Card contract

Each card should define:

- node schema
- editor UI
- serialization format
- web renderer
- email renderer if applicable
- validation
- optional migration handlers

## Example integration

```tsx
<VibressStudio
  document={post.content}
  onChange={updateContent}
  upload={mediaUploader}
  plugins={studioPlugins}
/>
```

The upload callback is supplied by Vibress; Studio does not know whether the actual storage is Local, S3, or R2.


## Host draft synchronization contract (2026-11-05)

`revisionId` is informational. It never resets Lexical. A changed
`replacementId` explicitly authorizes a non-collaborative root replacement;
keep it stable across autosave responses. In a collaborative editor, document
replacement belongs to the host Yjs session/provider lifecycle instead.

`metadataRevision` is an optional non-negative safe integer, monotonically
increasing within each replacement epoch. Assign it at the authoritative
metadata source, not when a response arrives. Once supplied, only a larger
value can acknowledge an envelope update; equal/older values cannot roll back
metadata. It does not authorize root replacement. PostEditor/PageEditor use the
server's persisted `version`. Unknown envelope/editor fields are retained by
validation and emitted snapshots. Without an ordering token, same-root echoes
after author edits cannot authorize metadata changes.

Rejected input pauses the mounted editor and suppresses snapshots. It retains
the active draft, selection and history. `recoveryLocale` selects English or
Arabic recovery UI independently of document direction. The host must retain
original rejected input for export/recovery; a future persisted version validates
without losing fields, but `migrateDocument` refuses to edit it with a typed
`UNSUPPORTED_DOCUMENT` containing the exact original input. This intentional
recovery-only contract differs from standalone persisted migration admission.

Post and page requests carry a document epoch, so delayed loads/saves cannot update
another active document, including an A → B → A route sequence. Default collaborative revision restore is explicitly disabled with a visible
English/Arabic explanation: a database restore and React remount cannot reset a
nonempty Yjs room. `enableCollaboration` remains true by default and is frozen at
PostEditor mount; a live prop change cannot bypass that gate. A host-owned
non-collaborative session may explicitly choose false at mount. That choice is
not a coordinated reset of existing remote sessions or persistent CRDT state.
Restoration through the API/other clients and a safe coordinated Yjs protocol
remain release blockers.

For a genuinely non-collaborative session, revision restore
confirmation authorizes the draft at click time. While restore is pending,
autosave/explicit saves wait; later local edits are kept and scheduled against
the acknowledged restored version. No empty-root heuristic or word-count
comparison authorizes destructive replacement.

### Reproducible integrity checks

```sh
pnpm exec vitest run --config vitest.studio-recovery.config.ts
```

This suite does not run the repository database-seeding global setup. For real
API/PostgreSQL/Redis tests, provision disposable services first and select
non-default localhost ports and a database named `studio_qa_*`:

```sh
STUDIO_ISOLATED_TESTS=1 \
DATABASE_URL=postgresql://studio_test@127.0.0.1:55439/studio_qa_integrity \
REDIS_URL=redis://127.0.0.1:56389 NODE_ENV=test \
pnpm exec vitest run --config vitest.studio-integration.config.ts
```

The config rejects common developer database/Redis ports. It still migrates and
seeds its explicitly isolated synthetic database. The four persistence cases
exercise authenticated post/page APIs, ordered snapshots, HTTP 409, exact reload,
legacy roots and separate record identities. The existing fourteen collaboration
cases exercise real WebSocket/Yjs/Redis behavior. Neither suite is a full browser
publishing acceptance study or proof of physical-device accessibility.


The host now applies a separate strict editable-node contract for its registered
0.13 node shapes before Lexical parses input. Unknown node fields/versions and
invalid structure remain accepted by permissive persisted validation, but enter
exact-input recovery rather than losing fields on the next save. This includes
unknown root, paragraph and text annotations. Envelope/editor extension data is
opaque and is never normalized as an AST. This does not establish full renderer,
card-specific nested editor or collaborative-client parity.
