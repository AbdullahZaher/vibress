# Security Policy

The Vibress team and community take the security and integrity of our open-source publishing platform seriously. This document defines our security policy, supported versions, private reporting procedures, severity handling SLAs, and security recommendations for operators.

---

## Supported Versions

Only the current major/minor GA releases receive active security updates and patches.

| Version | Supported | Security Maintenance Status |
| :--- | :---: | :--- |
| **`v1.1.x` (GA)** | :white_check_mark: | Current Active General Availability Release |
| **`v1.0.x`** | :white_check_mark: | Active Security Maintenance |
| `< 1.0.0` | :x: | Pre-release / Release Candidates (End of Life) |

---

## Reporting a Vulnerability

If you identify a security vulnerability in Vibress, **please do NOT report it in public GitHub issues, discussions, or pull requests.**

### Responsible Private Disclosure

1. **GitHub Private Security Advisory (Preferred):**  
   Submit a private advisory report directly via [GitHub Security Advisories](https://github.com/AbdullahZaher/vibress/security/advisories/new).
2. **Security Contact:**  
   If GitHub Advisories is unavailable, contact the project maintainers directly via repository security contacts.

### What to Include in Your Report

To help us investigate and remediate the issue rapidly, please provide:
- A clear description of the vulnerability, affected components (`apps/api`, `apps/worker`, `packages/security`, etc.), and potential security impact.
- Step-by-step reproduction instructions or a minimal Proof-of-Concept (PoC).
- Any specific configuration or environment requirements to reproduce the issue.
- Proposed mitigations or patches, if you have identified one.

---

## Response Process & SLAs

We follow a coordinated vulnerability disclosure process:

1. **Acknowledgement:** We will acknowledge receipt of your vulnerability report within **48 hours**.
2. **Triage & Assessment:** Our engineering team will triage and assess the severity using CVSS v3.1 within **5 business days**.
3. **Patch Development:** A security fix will be developed in a private repository fork.
4. **Release & Advisory:** A coordinated security release (e.g. `v1.0.1`) and public CVE/GitHub Security Advisory will be published once the patch is verified. Target resolution is within **30 days** of disclosure.

---

## Operator & Self-Hosting Security Guidelines

When self-hosting or operating Vibress in production:

1. **Cryptographic Secrets & Encryption:**
   - Always generate high-entropy secrets for `VIBRESS_ENCRYPTION_KEY`, `NEWSLETTER_UNSUBSCRIBE_SECRET`, `STRIPE_WEBHOOK_SECRET`, and `POSTGRES_PASSWORD` using `openssl rand -hex 32`.
   - Never commit `.env` or production credentials to source control.
2. **Network Topology & Isolation:**
   - Follow the official `compose.prod.yml` topology where PostgreSQL and Redis are bound exclusively to an internal-only network (`internal: true`) with no host or internet exposure.
   - Always place the Vibress gateway behind an edge reverse proxy (e.g. Cloudflare, Caddy, NGINX) with automated HTTPS/TLS termination.
3. **First-Run Setup Wizard Hardening:**
   - Supply `VIBRESS_SETUP_TOKEN` prior to the initial bootstrap. Once the initial Owner account is created, the setup endpoint is permanently and irreversibly locked (`OWNER_ALREADY_EXISTS`).
4. **Session Revocation:**
   - In case of staff account compromise or credential leakage, revoke active sessions via the Admin console (`revokeAllUserSessions`).
