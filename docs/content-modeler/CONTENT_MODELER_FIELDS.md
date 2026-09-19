# Vibress Content Modeler — Field Registry & Editors

The Content Modeler supports a production-grade registry of 17 distinct field types. Each field type defines its configuration schema, validation rules, admin editor component, storage format, and public serialization.

---

## Field Registry Matrix

| Field Type | Storage Type | Validation | Editor Component | API Visibility Options |
|---|---|---|---|---|
| `text` / `short_text` | `string` | minLength, maxLength, regex pattern | Single-line text input | public, authenticated, private |
| `long_text` | `string` | minLength, maxLength | Multi-line textarea | public, authenticated, private |
| `rich_text` | `string` / HTML | None | Rich text editor | public, authenticated, private |
| `studio_doc` | `JSON` AST / string | Schema Version 1 (Lexical) | Vibress Studio / Lexical | public, authenticated, private |
| `number` | `number` | min, max, integer/decimal | Numeric input (step support) | public, authenticated, private |
| `boolean` | `boolean` | boolean value | Toggle Switch | public, authenticated, private |
| `date` | `string` (YYYY-MM-DD) | Valid ISO date | Date Picker | public, authenticated, private |
| `datetime` | `string` (ISO 8601) | Valid ISO timestamp | DateTime Picker | public, authenticated, private |
| `url` | `string` | Absolute URL regex/URL parser | URL input with link tester | public, authenticated, private |
| `email` | `string` | RFC-5322 email regex | Email input | public, authenticated, private |
| `select` | `string` / `number` | Configured option whitelist | Dropdown Select | public, authenticated, private |
| `multi_select` | `string[]` | Configured option whitelist | Tag / Multi-select Pills | public, authenticated, private |
| `taxonomy` | `string[]` | Array of strings/tags | Taxonomy Tag Input | public, authenticated, private |
| `media` | `string` or `{ id, url, alt }` | Media asset ID or valid URL | Media Library Modal Picker | public, authenticated, private |
| `relation` | `string` (target entry ID) | Valid target entry in tenant | Searchable Single Entry Picker | public, authenticated, private |
| `relation_list` | `string[]` (entry IDs) | Valid target entries in tenant | Multi-entry Relation Picker | public, authenticated, private |
| `json` | `Record<string, unknown>` | Valid JSON syntax | Monospace JSON Editor | public, authenticated, private |

---

## Localization Support

Every field type can be marked as `localizable: true`. When enabled:
1. The admin editor renders language tabs (e.g. English `EN` and Arabic `AR`).
2. Data is stored internally as a localized dictionary:
   ```json
   {
     "title": {
       "en": "Summer Collection",
       "ar": "تشكيلة الصيف"
     }
   }
   ```
3. API and Liquid queries automatically resolve the field value according to the active request locale and fallback cascade.
