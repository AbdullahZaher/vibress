# Morrowe Magazine — Vibress Theme (v1.1.0)

**Morrowe Magazine** is a production-certified editorial magazine theme for the Vibress publishing platform, designed for culture, ideas, design, travel, and modern long-form publications.

## Key Features

- **Production-Certified Localization:** Full multilingual support with 100% dictionary parity between English (`en`) and Arabic (`ar`).
- **Complete RTL Support:** Built with 100% CSS logical properties (`margin-inline`, `padding-inline`, `start`, `end`), directional font fallbacks (Alexandria, Cairo, Tajawal, Amiri), and zero layout inversion bugs.
- **Editorial Typography:** High-contrast serif headlines, elegant kicker taxonomy, pastel category accents, and readable body geometry.
- **Responsive Magazine Grid:** Asymmetric lead story hero, vertical compact story stack, topic cards, and numbered latest stories feed.
- **Zero JavaScript Dependency:** Ultra-fast rendering with pure HTML & CSS.
- **Color Modes:** Automatic system mode, light mode, and dark mode support with tailored contrast tokens.

## Template Hierarchy

- `templates/home.liquid` — Magazine front page with lead hero, section highlights, topics, and latest stories.
- `templates/post.liquid` — Long-form article layout with reading time, author byline, feature media, and tag pills.
- `templates/page.liquid` — Clean editorial page layout.
- `templates/tag.liquid` — Section archive with custom hero art and story rows.
- `templates/author.liquid` — Contributor archive with avatar monogram and published story feed.
- `partials/header.liquid` — Announcement bar, wordmark brand, and primary navigation.
- `partials/footer.liquid` — Multi-column editorial footer with secondary navigation and edition notes.
- `partials/pagination.liquid` — Localized pagination controls.

## Localization Dictionaries

- `locales/en.json` — Default English localization dictionary (38 keys).
- `locales/ar.json` — Arabic localization dictionary (100% key parity).

## Installation

1. Upload `MORROWE_VIBRESS_MAGAZINE_v1.0.0.zip` (or `v1.1.0`) in **Vibress Admin → Settings → Themes → Upload Theme**.
2. Preview and activate the theme.
3. Switch your site locale between English (`en`) and Arabic (`ar`) — the theme adapts layout, typography, and UI copy automatically.
