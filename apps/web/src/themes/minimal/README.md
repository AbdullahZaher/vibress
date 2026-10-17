# Minimal theme: social profile icons

The Minimal theme renders social icons between the publication title and its configured footer text.

## Configure profiles

Publication owners add, reorder or remove social profiles under **Settings → Site → Social links** and save using the normal settings bar. These values are not specific to this theme; switching themes preserves them. When the collection is empty, no social icons are rendered.

## Rendering contract

The publication-aware site settings expose ordered `site.socialLinks` entries: `{ id, platform, label, url, iconUrl }`. The shared component is used in `components/Layout.tsx`:

```tsx
import { SocialLinks } from "../../../components/SocialLinks";

<SocialLinks links={site.socialLinks} locale={site.locale} />
```

`iconUrl` is a trusted local SVG route such as `/social-icons/instagram.svg`, rather than an external icon CDN. The component provides accessible link labels, decorative icons, keyboard focusable links, and Arabic/English navigation labels. Theme designers may reuse this component in another location by supplying the same collection.

- [Admin guide](../../../../../docs/administration/SOCIAL_LINKS_GUIDE.md) · [العربية](../../../../../docs/administration/SOCIAL_LINKS_GUIDE.ar.md)
- [External Liquid theme integration](../../../../../docs/themes/developer-guide.md)
