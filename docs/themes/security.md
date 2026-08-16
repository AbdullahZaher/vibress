# Vibress Theme System Security Architecture

External theme packages uploaded to Vibress run under strict defensive security guarantees to prevent Remote Code Execution (RCE), Directory Traversal (Zip Slip), Denial of Service (Zip Bombs), and privilege escalation.

---

## 1. Zero Server-Side Code Execution

- **No Executables Allowed**: Uploaded themes **never** execute JavaScript, TypeScript, JSX/TSX, Python, Ruby, PHP, or Shell scripts on the server.
- **Strict File Extension Allowlist**:
  - Templates & Manifests: `.liquid`, `.html`, `.json`
  - Style & Client Scripts: `.css`, `.js`, `.mjs`, `.map`
  - Graphics & Assets: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`, `.ico`, `.avif`
  - Typography: `.woff2`, `.woff`, `.ttf`, `.otf`, `.eot`
  - Documentation: `.md`, `.txt`, `LICENSE`
- **Immediate Rejection**: If an archive contains forbidden files (e.g. `.ts`, `.tsx`, `.exe`, `.sh`, `.py`, `.env`, `.yml`), the upload is rejected before extraction.

---

## 2. Archive & Resource Quotas

To protect against archive expansion attacks (Zip Bombs) and disk exhaustion:

| Constraint | Limit | Violation Action |
| :--- | :--- | :--- |
| **Max Compressed Size** | `20 MB` | Rejects upload immediately with `400 Bad Request`. |
| **Max Extracted Size** | `100 MB` | Rejects extraction with `ThemeZipError`. |
| **Max File Count** | `500 files` | Rejects extraction if archive exceeds file limit. |
| **Max Compression Ratio**| `50:1` | Protects against recursive compression payloads. |

---

## 3. Zip-Slip (Path Traversal) Prevention

- Every entry inside the ZIP archive is validated before reading:
  - Null bytes (`\0`) are forbidden.
  - Backslashes (`\`) are normalized to standard Unix `/`.
  - Leading slashes (`/path`) and relative navigation dots (`../`, `/..`) are strictly prohibited.
  - Paths must resolve within the isolated theme target directory `content/themes/{themeId}/{version}/`.

---

## 4. Sandboxed Liquid Execution

- The LiquidJS template engine operates strictly against an in-memory virtual filesystem (`MemoryFileSystem`).
- No direct OS filesystem access (`fs`), process spawning (`child_process`), network calls (`fetch`/`http`), or `eval`/`Function` constructs can be triggered from template files.
