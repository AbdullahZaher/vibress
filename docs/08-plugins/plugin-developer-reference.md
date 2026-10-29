# Vibress Plugin Developer Reference and Operational Guide

**Audience:** Plugin Authors, Extension Engineers, and Self-Hosted CMS Operators.  
**Language:** English.  
**Platform Version:** Vibress CMS 1.0+ / Plugin Platform M0–M6.

---

## 1. Architectural Overview & Boundaries

Vibress plugins provide safe, modular extensions to the core CMS without compromising multi-tenant boundaries or platform security.

```
+-----------------------------------------------------------------------+
|                         Vibress Host System                           |
|                                                                       |
|  +--------------------+   +---------------------+   +---------------+ |
|  | Native Admin UI    |   | Capability Gateway  |   | Process       | |
|  | Declarative Shell  |   | (Auth & Multi-Pub)  |   | Supervisor    | |
|  +---------^----------+   +----------^----------+   +-------^-------+ |
+------------|-------------------------|----------------------|---------+
             | Declarative JSON        | Host IPC / HMAC      | Subprocess
+------------v-------------------------v----------------------v---------+
|                  Tier 2 Isolated Plugin Runtime                       |
|  - Scrubbed Environment (No DB, Redis, or Host Secret access)         |
|  - Length-framed Mutual SHA-256 HMAC authenticated IPC channel        |
|  - Hard Memory Ceilings (default 64MB) & Timeout Fencing (default 3s)  |
|  - Crash-Loop Quarantine Failsafe (3 crashes / 30s)                   |
+-----------------------------------------------------------------------+
```

### Critical Trust Boundaries
1. **Host-Rendered Native Admin UI**:
   - Plugins declare UI using typed descriptors (`navItems`, `pages`, `views`, `actions`).
   - The Host Admin application renders all components natively.
   - **Zero Arbitrary HTML/JS in Host Origin**: Plugins never execute arbitrary client-side JavaScript or HTML in the trusted Admin browser session.
2. **Scrubbed Environment & Tier 2 Process Isolation**:
   - Untrusted marketplace plugins execute in dedicated child processes with scrubbed environment variables.
   - Host database credentials (`DATABASE_URL`), cache tokens (`REDIS_URL`), and cryptography keys (`JWT_SECRET`, keyrings) are strictly stripped.
3. **Host-Mediated Capability Gateway**:
   - Plugins request storage, secrets, or settings strictly via signed IPC envelopes.
   - Cross-publication access is blocked fail-closed.

---

## 2. Using `@vibress/plugin-sdk`

Plugin definitions are strongly typed through `@vibress/plugin-sdk`.

### Basic Plugin Definition
```typescript
import { definePlugin, resolveLocalizedLabel } from "@vibress/plugin-sdk";

export default definePlugin({
  id: "com.example.analytics",
  name: "Analytics Tracker",
  version: "1.0.0",
  capabilities: [
    "admin.navigation",
    "admin.views",
    "extension.storage.read",
    "extension.storage.write",
  ],
  admin: {
    navItems: [
      {
        id: "nav.analytics",
        label: {
          key: "nav.analytics.title",
          en: "Analytics Dashboard",
          ar: "لوحة تحليلات البيانات",
        },
        path: "/plugins/analytics",
        icon: "chart",
      },
    ],
    pages: [
      {
        id: "page.analytics.overview",
        route: "/plugins/analytics",
        title: {
          key: "page.analytics.overview.title",
          en: "Traffic & Engagement",
          ar: "حركة المرور والتفاعل",
        },
        viewId: "view.analytics.metrics",
      },
    ],
  },
  setup: async (context) => {
    context.log("Analytics plugin initialized successfully");
  },
});
```

### Localized Labels (BCP-47 & Arabic RTL Support)
Labels must support internationalization with fallback support:
```typescript
import { resolveLocalizedLabel } from "@vibress/plugin-sdk";

const label = {
  key: "btn.save",
  en: "Save Changes",
  ar: "حفظ التغييرات",
};

// Resolves Arabic in RTL context, falls back to English, then translation key
const text = resolveLocalizedLabel(label, "ar"); // "حفظ التغييرات"
```

---

## 3. Developer CLI Tooling (`vibress-plugin-cli`)

The Vibress CLI automates scaffolding, manifest validation, deterministic release packaging, keypair generation, and Ed25519 signing.

### 1. Scaffold a New Plugin
```bash
tsx scripts/plugins/vibress-plugin-cli.ts init com.vendor.myplugin "My Custom Plugin" ./plugins/myplugin
```

### 2. Validate Manifest
```bash
tsx scripts/plugins/vibress-plugin-cli.ts validate ./plugins/myplugin/manifest.json
```
Checks:
- Valid plugin ID format (alphanumeric, dots, hyphens)
- Semantic versioning compliance
- Valid declared capabilities
- Structural completeness

### 3. Package & Compute Release Digest
```bash
tsx scripts/plugins/vibress-plugin-cli.ts package ./plugins/myplugin
```
Outputs:
- Package identity: `com.vendor.myplugin@1.0.0`
- Release digest: `sha256:<64-hex-digest>`

### 4. Generate Developer Signing Keypair
```bash
tsx scripts/plugins/vibress-plugin-cli.ts keygen my-developer-key
```
Creates:
- `my-developer-key.pub.pem`
- `my-developer-key.key.pem`

### 5. Sign Plugin Release
```bash
tsx scripts/plugins/vibress-plugin-cli.ts sign ./plugins/myplugin/manifest.json my-developer-key.key.pem
```

### 6. Verify Signature
```bash
tsx scripts/plugins/vibress-plugin-cli.ts verify ./plugins/myplugin/manifest.json <signature-base64> my-developer-key.pub.pem
```

---

## 4. Safe Upgrade Lifecycle & State Machine

Plugin updates follow a strict, audited state machine:
```
[staged] -> [preflighted] -> [approved] -> [quiescing] -> [migrating] -> [activating] -> [observing] -> [completed]
     \            \             \              \             \              \
      \------------\-------------\--------------\-------------\--------------\--> [aborted] / [rolled_back]
```

- **Quiescence**: Active worker jobs and event subscriptions are drained before schema modifications.
- **Additive Migrations**: Schema migrations must be additive and safe for mixed-replica fleets.
- **Rollback Boundary**: Migrations flagged as irreversible block automatic schema rollback and require explicit operator confirmation.
- **Audited Purge**: Uninstallation preserves data by default. Purging plugin tables requires separate operator authorization and is written to immutable audit ledgers.

---

## 5. Self-Hosted Docker Deployment Runbook

### Environment Configuration
Ensure the following platform environment variables are set in your `.env` or Docker Compose deployment:

```bash
# Enable strict signature verification for operator-trusted lockfiles
VIBRESS_STRICT_OPERATOR_SIGNATURES=true

# Revoked public key fingerprints (comma-separated lowercase SHA-256)
VIBRESS_TRUSTED_PLUGIN_REVOKED_PUBLIC_KEYS_SHA256=

# Quarantine Staging Directory
VIBRESS_PLUGIN_STAGING_PATH=/var/lib/vibress/quarantine/plugins
```

### Production Health & Troubleshooting
- **Crash-Loop Quarantine (`PLUGIN_CRASH_LOOP_QUARANTINED`)**:  
  If a third-party plugin crashes 3 times within 30 seconds, the supervisor terminates the worker and places it in quarantine.  
  To reset quarantine: review plugin error logs, verify host compatibility, and call `supervisor.resetQuarantine(pluginId)`.
- **Invocation Timeout (`PLUGIN_TIMEOUT`)**:  
  Operations taking longer than 3,000ms are terminated to prevent event loop exhaustion. Plugins performing heavy computing must chunk work or schedule async jobs.
- **Cross-Publication Access Denied (`CROSS_PUBLICATION_DENIED`)**:  
  Ensure the capability request passes the active publication ID matching the request context.
