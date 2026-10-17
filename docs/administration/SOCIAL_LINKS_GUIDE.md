# Publication social media links

Social profile links belong to a **publication**, not to a specific theme and not to SEO share-card metadata. Configure them once and choose a theme without recreating them.

## Manage profiles

1. Sign in to the intended publication; open **Settings → Site → Social links**.
2. Select **Manage**, then **Add social link**.
3. Choose a platform, enter a descriptive **Label** (e.g. "Vibress on Instagram"), and paste the full **HTTPS profile URL**.
4. Use **Move link up / down** to set the order, or **Remove social link** to delete an entry.
5. Click the Settings page's **Save** button to persist your changes; **Discard** reverts unsaved edits.

The initial value is an empty list. Each link needs a unique internal ID, a nonempty label and an HTTPS URL without embedded credentials. The maximum is **20 profiles**; incomplete rows with blank URLs cannot be saved. Enter the *profile URL*, not just a platform homepage.

Supported platform IDs: `instagram`, `x`, `facebook`, `youtube`, `tiktok`, `linkedin`, `github`, `threads`, `mastodon`, `bluesky`, `telegram`, `whatsapp`, `pinterest`, `reddit`, `discord`, `rss`, and `custom` (generic link).

## Appearance in themes

Bundled **Default**, **Minimal** and **Molten** themes render social icons in their footers once profiles exist. Empty lists render no icons. All SVGs are shipped with Vibress and served from `/social-icons/<platform>.svg`, without a CDN.

Custom **Liquid** themes receive `site.socialLinks` and can display it in any template (header, footer, sidebar, etc.). Icons are **not automatically injected** into an external theme's markup. See [Theme developer guide](../themes/developer-guide.md) and [Liquid reference](../themes/templating.md).

## API, security and compatibility

`GET /api/content/v1/site` includes `site.socialLinks` as an ordered array of `{ id, platform, label, url, iconUrl }`; for previously installed publications it is `[]` until configured. Reading is public; editing uses the existing staff Settings API (`site.socialLinks`), which requires a staff session, `settings.manage`, origin validation and authoritative publication scoping.

The server validates the URL and platform on save; malformed persisted input is excluded from public output. The change is additive, does **not** require a database migration, and does not change old third-party theme requirements.

## Accessible labels and RTL

Use meaningful link names so assistive technology can identify the destination, e.g. "Vibress on YouTube" or "فايبرس على يوتيوب". The icon is decorative when the link has a name. Admin controls support keyboard-based ordering; theme designers should preserve clear focus styling and RTL-friendly spacing.

[الدليل بالعربية](SOCIAL_LINKS_GUIDE.ar.md)
