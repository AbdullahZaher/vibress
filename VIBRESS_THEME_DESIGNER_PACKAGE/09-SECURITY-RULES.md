# 09 — Security Rules & Sandboxing Invariants

Vibress treats all uploaded theme ZIP packages as **untrusted external input**. 

To protect the server, database, and visitors, every theme goes through an automated security validation gate during upload. This document explains the security architecture and rules your theme must comply with.

---

## 🔒 Security Principles

```text
┌────────────────────────────────────────────────────────┐
│                   ZIP SECURITY GATES                   │
│                                                        │
│  1. Archive Magic Bytes Check (PK\x03\x04)             │
│  2. Zip-Slip & Path Traversal Block (.., \0, :, /)     │
│  3. Symlink & FIFO Node Rejection                      │
│  4. Zip Bomb Guard (20:1 ratio, 100MB uncompressed)   │
│  5. Extension Allowlist (Strict No-JS Policy)          │
│  6. In-Memory MemoryFileSystem Virtualization          │
│  7. Strict JSON Schema Validation for Manifest         │
└────────────────────────────────────────────────────────┘
```

---

## 🚫 1. Strict No-JS Policy

Theme API v1 is **purely declarative and presentation-driven**. 

* **Prohibited Files**:
  Any archive containing `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.vue`, `.svelte`, `.py`, `.php`, `.rb`, `.sh`, `.bat`, `.cmd`, `.exe`, `.bin`, or `.wasm` is **immediately rejected** with code `THEME_FORBIDDEN_FILE_TYPE`.
* **Prohibited Inline Scripts**:
  Do not place raw inline executable `<script>` tags in templates. Vibress serves pages with strict Content-Security-Policy (CSP) headers and per-request cryptographic nonces.

---

## 🛡️ 2. Zip-Slip & Traversal Defenses

Every file path inside the ZIP is normalized and audited against directory traversal attacks:
* Paths containing `..` or relative parent references are rejected (`THEME_ZIP_SLIP_DETECTED`).
* Paths with null bytes (`\0`) or Windows drive specifiers (`C:`) are rejected.
* Absolute paths starting with `/` or `\` are rejected.
* Paths longer than 255 characters are rejected.

---

## 💣 3. Zip Bomb & Resource Quota Protections

To defend against compression denial-of-service (Zip Bombs):
* **Max Compressed ZIP Size**: 20 MB (`THEME_ZIP_TOO_LARGE`).
* **Max Total Extracted Size**: 100 MB (`THEME_ZIP_BOMB_DETECTED`).
* **Max Single File Size**: 10 MB (`THEME_FILE_TOO_LARGE`).
* **Max Total Files Count**: 500 files (`THEME_ZIP_TOO_MANY_FILES`).
* **Max Compression Ratio**: 20:1 (`THEME_ZIP_BOMB_DETECTED`).

---

## 🔗 4. Symlinks & Alias Blocking

All files in the theme archive must be real regular files. Any ZIP entry possessing POSIX symlink attribute headers (`0120000`) is rejected with `THEME_ZIP_SYMLINK_FORBIDDEN`.

---

## 🔐 5. Memory-Isolated Virtual Filesystem

When Liquid templates are rendered:
1. Templates are read exclusively from an in-memory `MemoryFileSystem`.
2. The template engine has **zero access** to the host filesystem, Node.js `fs` module, operating system environment variables, network sockets, or child processes.
3. Liquid rendering operates asynchronously with strict bounds.

---

## 📋 Security Checklist for Theme Authors

Before packaging your theme:
- [x] Ensure **zero** `.js` or `.ts` files exist in `assets/` or `templates/`.
- [x] Verify all images are valid (`.svg`, `.png`, `.jpg`, `.webp`).
- [x] Verify no hidden `.env`, `.git`, or system files (`.DS_Store`, `Thumbs.db`) are included.
- [x] Ensure `theme.json` and `settings.json` are valid, well-formed JSON.
- [x] Test your archive using the local validator: `node scripts/validate-theme.mjs my-theme.zip`.

---

Next: Read **[`10-RESPONSIVE-RTL-ACCESSIBILITY.md`](./10-RESPONSIVE-RTL-ACCESSIBILITY.md)** to ensure top-tier accessibility and multi-language/RTL support.
