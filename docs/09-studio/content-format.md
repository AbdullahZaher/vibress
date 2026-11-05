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
