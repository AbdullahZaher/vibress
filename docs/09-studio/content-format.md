# Vibress Studio Content Format

## Canonical source

The canonical source of editable content is a versioned structured document, not generated HTML.

Example:

```json
{
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
