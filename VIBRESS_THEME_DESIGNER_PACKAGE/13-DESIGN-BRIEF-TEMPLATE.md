# 13 — Theme Design Brief Template

Use this template to plan and align on the design requirements for your custom Vibress theme before writing code.

---

# 🎨 Vibress Theme Design Specification Brief

## 1. 📌 Theme Overview
* **Theme Name**: `[e.g. Atlas Chronicle]`
* **Theme ID**: `[e.g. atlas-chronicle]` *(lowercase alphanumeric with hyphens)*
* **Version**: `1.0.0`
* **Theme API Version**: `1`
* **Target Audience**: `[e.g. Technology founders, venture capitalists, researchers]`
* **Primary Archetype**:
  - [ ] News / Daily Newspaper
  - [ ] Editorial Magazine
  - [ ] Tech / Developer Blog
  - [ ] Personal Thought Leadership
  - [ ] Minimalist Long-Form Essay
  - [ ] Marketing & Product Landing

---

## 2. 🎨 Visual Identity & Color Tokens

| Token Name | Light Mode Value | Dark Mode Value | Usage |
| :--- | :--- | :--- | :--- |
| `--theme-bg` | `#FFFFFF` | `#0B0F19` | Page background |
| `--theme-surface` | `#F8FAFC` | `#151D2E` | Cards, navbar, footer |
| `--theme-border` | `#E2E8F0` | `#1E293B` | Dividers and borders |
| `--theme-text` | `#0F172A` | `#F8FAFC` | Main headings & paragraphs |
| `--theme-text-muted`| `#64748B` | `#94A3B8` | Metadata, dates, bylines |
| `--theme-accent` | `#6366F1` | `#818CF8` | Buttons, links, badges |

---

## 3. 🔤 Typography & Font Stacks

* **Headings Font**: `[e.g. 'Newsreader', serif / 'Inter', sans-serif]`
* **Body Text Font**: `[e.g. 'Inter', system-ui, sans-serif]`
* **Code / Monospace**: `[e.g. 'JetBrains Mono', monospace]`
* **RTL Arabic Fallback**: `[e.g. 'IBM Plex Sans Arabic', 'Cairo', sans-serif]`

---

## 4. 📐 Template Layout Requirements

### 🏠 Homepage (`home.liquid`)
* **Hero Banner Style**: `[e.g. Large featured article with split 2-column latest news]`
* **Grid Format**: `[e.g. 3-column masonry / 2-column list]`
* **Sidebar**: `[e.g. No sidebar / Right-hand trending tags]`
* **Newsletter Box**: `[e.g. Bottom full-width banner]`

### 📝 Single Article (`post.liquid`)
* **Header Layout**: `[e.g. Full-width cover image with centered title and byline]`
* **Reading Progress Bar**: `[e.g. Yes, top pure CSS animated bar]`
* **Author Card**: `[e.g. Boxed at bottom of post with avatar and bio]`
* **Tags Display**: `[e.g. Pill badges at bottom]`

### 📄 Static Page (`page.liquid`)
* **Layout**: `[e.g. Centered single-column reading canvas (max-width 740px)]`

### 🏷️ Tag & Author Archives (`tag.liquid` / `author.liquid`)
* **Header**: `[e.g. Tag title + count of articles, author avatar + biography]`
* **Listing**: `[e.g. 2-column compact list with pagination]`

---

## 5. 🎛️ Configurable Theme Settings (`settings.json`)

List the settings you want site owners to be able to configure:

1. **`accentColor`** (`color`): Brand highlight color. Default: `#6366f1`
2. **`heroHeadline`** (`string`): Homepage banner title. Default: `Stories & Insights`
3. **`showReadingTime`** (`boolean`): Show read time on cards. Default: `true`
4. **`showAuthorAvatars`** (`boolean`): Show author avatar circles. Default: `true`
5. **`postsPerPage`** (`number`): Articles per page. Default: `12` (min: 4, max: 40)
6. **`layoutStyle`** (`select`): `["grid", "magazine", "compact"]`. Default: `"magazine"`

---

## 6. 📅 Delivery Checklist & Sign-Off
- [ ] Validated with `node scripts/validate-theme.mjs`
- [ ] Tested on Mobile (320px) and Desktop (1440px)
- [ ] Tested in Dark Mode and RTL (Arabic)
- [ ] Delivered as `[theme-name]-v1.0.0.zip`
