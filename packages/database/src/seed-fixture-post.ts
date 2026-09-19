import { getDb } from "./connection";
import { publications, users, posts, postAuthors, revisions } from "./schema";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

export const TARGET_POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";
export const PUBLICATION_ID = "pub_default";

export const FIXTURE_POST_SLUG = "architecture-of-modern-digital-publishing";
export const FIXTURE_POST_TITLE =
  "The Architecture of Modern Digital Publishing: High-Performance Layouts, Fluid Typography, and the Renaissance of Independent Media";
export const FIXTURE_POST_EXCERPT =
  "An in-depth exploration of modern editorial engineering—how typography hierarchies, asymmetric grid layouts, bidirectional Liquid architecture, and sovereign community systems are resurrecting independent digital publications.";

export const FIXTURE_STUDIO_CHILDREN: any[] = [
  // Intro
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "For more than two decades, the open web has fought a continuous war against homogenization. The early era of personal blogging and indie zines—celebrated for idiosyncrasy, artisanal typography, and bespoke layouts—gradually surrendered to the centralized algorithmic feed. What followed was a decade of standardized grey containers, uniform infinite scrolls, and generic card components designed for engagement metrics rather than sustained human reading.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Yet beneath the surface of this corporate web, a quiet revolution has arrived. Independent authors, critical journals, and boutique media houses are reclaiming autonomy. They are demanding publishing tools that do not treat content as disposable data payloads, but as crafted cultural artifacts. Building an independent publication today is not merely about hosting markdown files on a server; it is an architectural discipline that weaves together micro-typography, fluid container physics, resilient asset pipelines, and decentralized community discussions.",
      },
    ],
  },
  {
    type: "quote",
    children: [
      {
        type: "text",
        format: 2, // italic
        text: "“When typography is executed with intentional rhythm and the layout breathes with editorial confidence, the reader no longer scans—they inhabit the narrative.”",
      },
    ],
  },

  // Section 1
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1, // bold
        text: "1. The Typography Hierarchy: Moving Beyond Generic Sans-Serifs",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "The foundation of any serious editorial publication is its typographic voice. For too long, digital products defaulted to system sans-serif fonts under the guise of minimalism, stripping away the distinct literary character that historically distinguished publications like The Atlantic, Monocle, or The Paris Review. In modern publishing architecture, typography is not a cosmetic layer; it is the fundamental user interface.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Modern editorial design pairs expressive, high-contrast serif display faces—such as Fraunces, Cinzel, or Playfair—for titles and kickers, with robust, legible geometric sans-serifs for running deck text and metadata stamps. This contrast creates an unmistakable visual rhythm. Headlines command presence with tight letter-spacing and substantial vertical weight, while body copy flows effortlessly across generous line-heights calibrated between 1.65 and 1.75.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Crucially, typographic scale must be fluid rather than stepped. By utilizing modern CSS clamp functions—such as clamp(2.4rem, 5vw, 4.8rem) for lead titles—type scales proportionally across viewports from ultra-wide cinema displays to compact mobile touchscreens without erratic reflows or orphan words. Furthermore, vertical rhythm is preserved through proportional modular scales, ensuring that drop caps, lead paragraphs, and blockquotes sit comfortably within the optical grid.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Micro-typography requires meticulous attention to measure—the width of a text block. Extensive cognitive research demonstrates that optimal reading comfort is achieved between 65 and 75 characters per line. When lines stretch beyond 80 characters, the human eye struggles to track the transition from the end of one line to the beginning of the next, inducing subtle cognitive friction that accelerates reader bounce rates. In Vibress themes like Morrowe and Minimal, reading containers are strictly pinned to 720–760px, maintaining an ideal measure across all screen resolutions.",
      },
    ],
  },

  // Section 2
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "2. Layout Geometry: The Asymmetric Power of Grid-First Editorial Design",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "The single-column centered layout has dominated blogging platforms since 2010. While functional for short notes, it suffocates rich journalism. Magazine layouts thrive on asymmetric tension: featured hero stories that claim 60% of the visual plane, accompanied by editorial sidebars, numbered kicker stamps, issue indicators, and curated category highlights.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "A grid-first magazine architecture organizes content across three distinct layout tiers:",
      },
    ],
  },
  {
    type: "list",
    listType: "bullet",
    children: [
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "The Broadside Front Grid: ",
          },
          {
            type: "text",
            text: "An asymmetrical split layout pairing a high-impact lead feature with curated secondary perspective columns and issue marks.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "The Curated Gallery: ",
          },
          {
            type: "text",
            text: "Multi-column topic grids with color-coded taxonomy badges, reading time estimates, and author avatars.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "The Reading Sanctum: ",
          },
          {
            type: "text",
            text: "A laser-focused reading column constrained to 720–760px with generous margins, pull quotes, and integrated community comments.",
          },
        ],
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "By establishing strict horizontal rules, subtle paper textures, and deliberate border contrasts, the publication establishes architectural permanence. The interface feels physical, structured, and deliberate—a tactile sanctuary from the chaotic noise of modern social networks.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Editorial layouts also embrace intentional white space. White space in high-end publishing is not empty void; it is the structural scaffolding that directs the eye. Generous vertical margins between thematic sections give the reader psychological space to process complex arguments before diving into supporting analyses or commentary.",
      },
    ],
  },

  // Section 3
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "3. Liquid-Native Architecture: Server-Driven Simplicity Meets Client Hydration",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "In the engineering of modern publishing platforms, framework bloat is a persistent hazard. Overly complex single-page application architectures frequently introduce massive JavaScript bundles, sluggish time-to-first-byte (TTFB), and fragile routing mechanics that frustrate casual readers and harm search engine crawlability.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Vibress solves this dilemma through a hybrid Liquid-native engine. Core page structures, metadata headers, and article bodies are compiled on the server into pristine semantic HTML using declarative Liquid templates. The client browser receives instant markup with zero render-blocking JavaScript hurdles. When interactive subsystems are required—such as live community comments, newsletter subscription drawers, or theme mode switchers—micro-hydrators mount surgically into isolated DOM islands.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "This dual-mode approach delivers exceptional benefits for independent publishers:",
      },
    ],
  },
  {
    type: "list",
    listType: "number",
    children: [
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "Sub-50ms Time to First Contentful Paint: ",
          },
          {
            type: "text",
            text: "Readers experience instantaneous document delivery across 3G mobile networks and high-latency edge connections.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "100% Theme Portability: ",
          },
          {
            type: "text",
            text: "Themes are packaged as standard zip archives containing Liquid templates, JSON manifests, and localized dictionaries without requiring custom server recompilation.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "Bulletproof SEO & Open Graph Metadata: ",
          },
          {
            type: "text",
            text: "Canonical links, JSON-LD structured schema markup, Twitter cards, and multi-lingual alternate tags are baked directly into server responses.",
          },
        ],
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Consider the contrast with legacy content management systems where themes are intertwined with database querying logic. In Vibress Theme Architecture, themes are strictly presentation-bound. The server pre-computes normalized view models—including calculated reading times, paginated story streams, author archives, and batched comment counts—and delivers them directly to Liquid execution contexts. This guarantees zero N+1 database leaks and enables sub-millisecond template rendering.",
      },
    ],
  },

  // Section 4
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "4. Global by Design: The Engineering of First-Class RTL & Bidirectional Typography",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Digital publishing has historically suffered from Western bias. Right-to-left (RTL) scripts—including Arabic, Hebrew, Persian, and Urdu—have too often been treated as secondary afterthoughts, resulting in broken margins, flipped punctuation, misplaced chevron arrows, and jarring font mismatches.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "In a world-class editorial system, RTL is not an override stylesheet; it is an intrinsic dimension of the design system. By adopting CSS Logical Properties across every layout token—substituting physical margins with margin-inline-start and margin-inline-end, and physical padding with padding-block and padding-inline—the entire magazine effortlessly transforms when switching languages.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Furthermore, typography switches dynamically to authentic regional typefaces like Tajawal and Noto Naskh Arabic, which preserve the natural calligraphic baseline and majestic ligatures of Arabic script without letter-spacing distortions.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "When an article is rendered in Arabic, the editorial deck, the author byline, the date badges, and even the comment action arrows re-orient seamlessly with zero horizontal layout shift. Localization dictionaries handle dynamic pluralization forms (such as Arabic dual and plural grammatical rules), ensuring that '2 comments' renders as 'تعليقان' rather than clumsy machine translations.",
      },
    ],
  },

  // Section 5
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "5. Sovereign Community: Why Decentralized Discussions and Moderation Matter",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "The final pillar of independent publishing is audience sovereignty. When media creators outsourced their comments to third-party ad networks and iframe widgets, they traded away reader privacy, page performance, and community trust. Third-party trackers bloat web pages with megabytes of telemetry, while sudden platform policy changes can erase years of thoughtful reader discourse overnight.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Vibress restores sovereignty by embedding native, publication-isolated comments directly into the core data layer. Discussions are stored in immutable relational schemas, protected by strict publication isolation, rate-limiting, and cryptographic audit logs. Readers enjoy lightning-fast discussions that match the exact aesthetic of the active theme—from sharp 4px architectural cards in Morrowe to organic curves in Molten—while site owners retain 100% control over moderation, reporting, and member access.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Community health is reinforced through multi-tiered access control. Publications can configure comments as open to the public, restricted to verified subscribers, or exclusively reserved for premium tier members. Idempotency keys prevent double submissions on flaky mobile connections, while an immutable moderation log ensures that editorial decisions remain auditable, transparent, and resilient.",
      },
    ],
  },

  // Section 6
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "6. The Visual Philosophy of Dark Mode Ergonomics",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Dark mode in digital journalism is frequently misunderstood. Many platforms simply invert colors, replacing crisp white backgrounds with pitch black #000000. In high-density reading environments, pure black backgrounds create intense ocular contrast that causes halation—a optical phenomenon where bright text appears to bleed or vibrate against the dark void, straining the reader's eyes during long reading sessions.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Morrowe Magazine implements an architectural dark palette engineered specifically for long-form immersion:",
      },
    ],
  },
  {
    type: "list",
    listType: "bullet",
    children: [
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "Deep Obsidian Canvas (#0C0D10): ",
          },
          {
            type: "text",
            text: "A subtle warm dark baseline that eliminates glare without the harshness of pure black.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "Layered Surface Cards (#171920 & #1F222B): ",
          },
          {
            type: "text",
            text: "Elevated surfaces that establish spatial hierarchy for comment composers, author sidebars, and pullout quotes.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "Soft Bone Typography (#F7F6F2 & #B4B6BF): ",
          },
          {
            type: "text",
            text: "Text hues formulated to provide an optimal 12.5:1 contrast ratio that exceeds WCAG AAA accessibility standards.",
          },
        ],
      },
      {
        type: "listitem",
        children: [
          {
            type: "text",
            format: 1,
            text: "Acid Lime Accent Highlights (#D8F75A): ",
          },
          {
            type: "text",
            text: "A high-visibility chromatic signature used sparingly for primary call-to-actions, category badges, and active comment timestamps.",
          },
        ],
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "By treating dark mode as an independent lighting discipline rather than a naive algorithmic color inversion, modern publications create an inviting sanctuary where readers can explore deep investigative stories for hours in total visual comfort.",
      },
    ],
  },

  // Section 7
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "7. The Media Pipeline: Zero Layout Shifts and Next-Gen Codecs",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Visual media in modern editorial publications must balance breathtaking aesthetic clarity with uncompromising performance budgets. In the print world, art directors spent decades mastering full-bleed photography, duotone illustrations, and archival paper grades. In digital media, this discipline translates into modern image pipeline architecture.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Every piece of photography uploaded to Vibress is automatically transformed into modern WebP and AVIF formats with multi-resolution source sets (srcset). Intrinsic aspect ratios are preserved directly in CSS grid layouts, preventing Cumulative Layout Shift (CLS) from disturbing readers as high-resolution photo essays load asynchronously. Captions are treated as first-class editorial elements with dedicated typography and subtle borders, honoring the photographers and illustrators who bring stories to life.",
      },
    ],
  },

  // Section 8
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "8. The Engineering of Theme Isolation & Zero-Leak Extensibility",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "A fatal flaw in many extensible web architectures is style and script contamination. When custom themes, community plugins, and dynamic widgets share global stylesheets without strict encapsulation, naming collisions inevitably corrupt the reading experience. A button intended for a comment form inadvertently inherits rules from an analytics plugin, breaking paddings and visual balance.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Vibress implements a rigorous theme certification protocol and namespace governance model. Every theme—whether built natively with React primitives or rendered through the Liquid Theme Engine—operates within isolated root containers (e.g. .vibress-liquid-theme-root and .morrowe). All design tokens are passed as standard CSS Custom Properties that cascade predictably without mutating foreign document nodes.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "Furthermore, the Theme API enforces strict capabilities checks. Themes declare supported features in a declarative theme.json manifest—including custom post layouts, archive views, author dossiers, dynamic localization, and community comment hooks. If an archive fails certification or contains invalid liquid syntax, the platform falls back gracefully to a verified baseline theme, ensuring that readers never encounter broken pages or white-screen-of-death errors.",
      },
    ],
  },

  // Section 9
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "9. Monetization and Direct Reader Relationships",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "For independent publications, economic sustainability is inextricably linked to editorial independence. Advertising-supported business models inevitably force publishers into a tragic race to the bottom: clickbait headlines, sensationalized controversies, and intrusive popups designed to maximize impression yield. The direct reader subscription model flips this perverse incentive structure on its head.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "When readers pay directly for journalism, the publication's singular incentive is to maximize depth, truth, and aesthetic excellence. Modern publishing engines must therefore integrate frictionless membership tiers, native newsletter delivery, and metered paywalls that respect the reader. Subscription cards, member badges in comment threads, and exclusive subscriber dossiers become natural extensions of the editorial identity rather than disruptive paywall barricades.",
      },
    ],
  },

  // Section 10
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "10. The Cognitive Architecture of Deep Reading",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "In the final analysis, publishing software is cognitive software. The human brain was not evolved to process fifty competing notifications, flashing banner ads, and auto-playing videos while attempting to comprehend deep investigative reporting or philosophical treatises. Every design choice either protects or fractures the reader's attention.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "By establishing predictable reading rhythms, removing gratuitous animations, implementing smooth scroll kinematics, and providing clear reading time estimates, we honor the intellectual covenant between author and reader. The interface recedes into the background, leaving only the pristine dialogue between the writer's thought and the reader's contemplation.",
      },
    ],
  },

  // Section 11: Conclusion
  {
    type: "heading",
    tag: "h2",
    children: [
      {
        type: "text",
        format: 1,
        text: "Conclusion: Crafting Media That Outlives the Algorithm",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "The renaissance of independent digital media is ultimately a return to craftsmanship. When creators control their tools, respect their readers' cognitive attention, and invest in enduring aesthetic quality, journalism reclaims its cultural gravity. By combining high-contrast typography, fluid grid geometry, high-performance Liquid engines, and sovereign community infrastructure, we can build publications that do not merely capture attention for a fleeting second, but remain indelible for generations.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "As we look ahead to the next decade of web publishing, the platforms that will endure are not those that chase algorithmic trends, but those that honor the written word and the human community gathered around it.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        type: "text",
        format: 1,
        text: "The future of publishing belongs to those who dare to build deliberately. Welcome to the new era of independent media.",
      },
    ],
  },
];

export async function seedFixturePost(): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [pub] = await db
    .select()
    .from(publications)
    .where(eq(publications.id, PUBLICATION_ID));
  if (!pub) {
    return;
  }

  const [author] = await db.select().from(users).limit(1);
  if (!author) {
    return;
  }

  const lexicalContent = {
    schema: "vibress-studio",
    version: 1,
    editor: { lexicalVersion: "0.13.1" },
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      children: FIXTURE_STUDIO_CHILDREN,
    },
  };

  const [existingPost] = await db
    .select()
    .from(posts)
    .where(eq(posts.id, TARGET_POST_ID))
    .limit(1);

  if (!existingPost) {
    await db.insert(posts).values({
      id: TARGET_POST_ID,
      publicationId: PUBLICATION_ID,
      title: FIXTURE_POST_TITLE,
      slug: FIXTURE_POST_SLUG,
      excerpt: FIXTURE_POST_EXCERPT,
      content: lexicalContent,
      contentVersion: 1,
      status: "published",
      visibility: "public",
      version: 1,
      primaryAuthorId: author.id,
      createdBy: author.id,
      updatedBy: author.id,
      publishedBy: author.id,
      publishedAt: now,
      metaTitle: FIXTURE_POST_TITLE,
      metaDescription: FIXTURE_POST_EXCERPT,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .insert(postAuthors)
      .values({
        postId: TARGET_POST_ID,
        userId: author.id,
        sortOrder: 0,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  const [existingRev1] = await db
    .select()
    .from(revisions)
    .where(
      and(
        eq(revisions.resourceType, "post"),
        eq(revisions.resourceId, TARGET_POST_ID),
        eq(revisions.revisionNumber, 1),
      ),
    )
    .limit(1);

  if (!existingRev1) {
    await db.insert(revisions).values({
      id: crypto.randomUUID(),
      resourceType: "post",
      resourceId: TARGET_POST_ID,
      revisionNumber: 1,
      title: FIXTURE_POST_TITLE,
      slug: FIXTURE_POST_SLUG,
      excerpt: FIXTURE_POST_EXCERPT,
      content: lexicalContent,
      contentVersion: 1,
      createdBy: author.id,
      createdAt: now,
    });
  }
}
