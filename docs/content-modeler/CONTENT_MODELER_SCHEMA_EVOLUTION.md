# Vibress Content Modeler — Schema Evolution & Migrations

Content models naturally evolve over time. Vibress provides an automated Schema Evolution engine that analyzes proposed field modifications against existing entries, classifies changes as safe or breaking, and provides a preview diff before changes are persisted.

---

## 1. Schema Diff & Analysis Engine

When model fields are updated or previewed via `POST /api/admin/v1/content-models/:id/schema-evolution-preview`, the service performs a field-by-field diff:

1. **Added Fields (`added`)**:
   - Marking a new field as optional is always **safe**.
   - Marking a new field as `required: true` when entries already exist produces a **warning** that existing entries will lack the required field.
2. **Removed Fields (`removed`)**:
   - Field removals produce a **warning** that historical data for that key will no longer be visible or rendered. Existing JSON values are preserved in historical versions.
3. **Renamed Fields (`renamed` via `renamedFrom`)**:
   - Automatically migrates existing data values from `oldKey` to `newKey` across entries.
4. **Modified Field Types (`modified`)**:
   - Compatible type mutations (e.g. `text` -> `long_text` or `date` -> `datetime`) are marked **safe**.
   - Incompatible mutations (e.g. `text` -> `number` or `boolean` -> `relation`) produce an **unsafe** warning, requiring explicit confirmation.

---

## 2. API Response Contract

```json
{
  "data": {
    "modelId": "mod_books",
    "safe": true,
    "warnings": [
      "Field 'isbn' was removed. Historical entries will preserve data in revisions."
    ],
    "changes": [
      {
        "key": "isbn",
        "action": "removed",
        "isSafe": true,
        "warnings": ["Field 'isbn' was removed."]
      },
      {
        "key": "edition_year",
        "action": "added",
        "isSafe": true
      }
    ]
  }
}
```
