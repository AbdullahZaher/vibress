# Vibress API & Extension Compatibility Matrix

## Semantic Versioning Guarantees

Vibress adheres strictly to Semantic Versioning (SemVer 2.0.0):
- **MAJOR**: Breaking changes to core database schemas, SDK interfaces, or REST endpoints.
- **MINOR**: Backward-compatible new features, new field types, or added SDK capabilities.
- **PATCH**: Backward-compatible bug fixes and security remediations.

---

## SDK Version Compatibility Matrix

| Vibress Core Version | `@vibress/plugin-sdk` | `@vibress/theme-core` | Status |
| :--- | :--- | :--- | :--- |
| `1.0.x` | `1.0.0` | `1.0.0` | Active / Supported |
| `0.9.x` | `0.9.0` | `0.9.0` | Deprecated (Migration recommended) |

---

## Deprecation Policy

1. Any method or API marked for deprecation will emit a runtime warning for at least **one minor version cycle** before removal.
2. The `PluginManifest.vibressApiVersion` field enforces compatibility at runtime, preventing incompatible extensions from loading and causing system instability.
