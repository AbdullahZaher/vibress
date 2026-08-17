# 12 — Packaging & Delivery Instructions

This document explains how to package your theme into a clean, valid `.zip` archive and deliver it to your client or publication owner.

---

## 🗂️ 1. Final Pre-Packaging Cleanup

Before zipping, ensure your theme directory is clean:

1. **Remove OS Artifacts**: Delete all `.DS_Store`, `Thumbs.db`, and `__MACOSX` folders.
2. **Remove Git Folders**: Do not include `.git/` or `.gitignore` inside the theme ZIP.
3. **Verify File Extensions**: Double check that there are **zero** `.js` or `.ts` files anywhere in the package.

```text
my-theme/
├── theme.json
├── settings.json
├── preview.webp
├── assets/
│   ├── css/
│   │   └── theme.css
│   ├── fonts/
│   └── images/
├── partials/
│   ├── header.liquid
│   ├── footer.liquid
│   └── pagination.liquid
└── templates/
    ├── home.liquid
    ├── post.liquid
    ├── page.liquid
    ├── tag.liquid
    └── author.liquid
```

---

## 📦 2. Creating the ZIP Archive

### On macOS / Linux (Terminal)
Navigate into your theme folder and compress its contents:

```bash
cd path/to/my-theme

# Zip all contents without OS hidden files
zip -r ../my-theme-v1.0.0.zip . -x "*.DS_Store" -x "__MACOSX*" -x "*.git*"
```

### On Windows (PowerShell)
```powershell
Compress-Archive -Path .\* -DestinationPath ..\my-theme-v1.0.0.zip -Force
```

---

## 🔍 3. Validating the Packaged ZIP

Run the automated validator on your newly created ZIP:

```bash
node scripts/validate-theme.mjs ../my-theme-v1.0.0.zip
```

Expected output:
```text
✔ Archive structure valid
✔ theme.json manifest valid (themeApi: 1)
✔ Required templates found (home, post, page)
✔ Preview image present
✔ 0 forbidden script files detected
✔ settings.json schema valid
🎉 THEME PACKAGE IS 100% PRODUCTION READY!
```

---

## 📬 4. Delivering to the Site Owner

When delivering the work to your client or publishing team, provide:

1. **The Production ZIP File** (e.g. `my-theme-v1.0.0.zip`).
2. **High-Resolution Screenshots / Preview** (1200x800px or 16:9 aspect ratio).
3. **Brief Release Notes / Changelog** (highlighting custom settings available in `settings.json`).

---

## 🚀 5. How the Site Owner Installs Your Theme

Inform the administrator that installation takes under 10 seconds:

```text
1. Log into Vibress Admin
2. Go to Settings → Themes
3. Click "Upload Theme"
4. Select `my-theme-v1.0.0.zip`
5. Click "Validate & Install"
6. Click "Preview" to inspect
7. Click "Activate" to go live!
```

Zero terminal commands, zero rebuilds, and zero downtime required!

---

Next: Explore **[`13-DESIGN-BRIEF-TEMPLATE.md`](./13-DESIGN-BRIEF-TEMPLATE.md)** and the example briefs (**15-17**).
