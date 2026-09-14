# VIBRESS — MULTILINGUAL & TRANSLATION INTELLIGENCE PLAN
## Production i18n Architecture, Persistent Glossary, Translation Memory & AI Quality

---

## 1. Production-Ready Audit: Current i18n State

### What Is Genuinely Production-Ready
1. **Locale Engine & Direction**:
   - `LocaleRegistry` in `packages/i18n/src/registry.ts` supports BCP-47 canonicalization, fallback chains (e.g. `ar-SA` → `ar` → `en`), and bidirectional metadata (`ltr` vs `rtl`).
   - Standard formatters for Gregorian dates, numbers, currency, and relative timestamps using native `Intl` APIs.
   - Hijri (Islamic lunar) calendar formatting via `Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura")`.
2. **Arabic Text Normalization**:
   - `normalizeArabicText` in `packages/i18n/src/text-normalizer.ts`:
     - Strips Tashkeel / Harakat (diacritics: Fatha, Damma, Kasra, Sukun, Tanwin, Shadda).
     - Strips Tatweel / Kashida (`ـ`).
     - Normalizes Alef variants (`أ`, `إ`, `آ` → `ا`), Taa Marbuta (`ة` → `ه`), and Alef Maksura (`ى` → `ي`).
3. **Translation Workflow & Storage**:
   - `content_translations` table stores localized versions of posts, pages, and dynamic entries.
   - 8-stage translation lifecycle: `untranslated` → `draft` → `in_progress` → `translated` → `needs_review` → `approved` → `published` (and `stale`).
   - Stale detection detects when the source article has been updated since the translation was completed.
   - Translation Matrix API exposes complete cross-locale completion metrics.

### Critical Gaps
1. **In-Memory Glossary**: The translation glossary is a hardcoded static class (`TranslationGlossary` in `packages/i18n/src/glossary.ts`). Editors cannot add, edit, or delete glossary terms in Admin.
2. **No Translation Memory (TM)**: Sentences and paragraphs previously translated are not broken into translation units or indexed for fuzzy reuse. Every translation job translates from scratch.
3. **Missing Automated Quality Scoring**: No objective translation quality metric (e.g., semantic similarity, terminology compliance score, or LLM-as-judge scoring).
4. **No Publication Boundary**: `content_translations` table lacks `publication_id`.

---

## 2. Target Design: The 5 Translation Intelligence Pillars

```
┌────────────────────────────────────────────────────────────────────────┐
│                   VIBRESS TRANSLATION INTELLIGENCE                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1. PERSISTENT GLOSSARY (DB-Backed Terminology Management)            │
│     • Custom terms per publication with mandatory AI enforcement       │
│     • Prohibited translations & case-sensitive brand definitions       │
│                                                                        │
│  2. TRANSLATION MEMORY ENGINE (TM)                                     │
│     • Sentence segmentation & hash indexing                           │
│     • 100% exact matches (free reuse) + 70-99% fuzzy matches          │
│                                                                        │
│  3. AI TRANSLATION CONSISTENCY                                         │
│     • Context-aware batch translation preserving Lexical JSON structure│
│     • Glossary constraints injected into system prompts                │
│                                                                        │
│  4. QUALITY EVALUATION & SCORING                                       │
│     • Automated quality score (0 - 100) combining:                     │
│       - Glossary adherence check                                       │
│       - Formatting tag balance check                                   │
│       - Length ratio anomaly check                                     │
│                                                                        │
│  5. TWO-TIER HUMAN REVIEW WORKFLOW                                     │
│     • Side-by-side bilingual diff editor in Admin                      │
│     • Translator role submit → Editorial review queue → Approval gate  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema Extensions

```sql
-- 1. Publication Glossary Terms
CREATE TABLE publication_glossaries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  source_locale TEXT NOT NULL DEFAULT 'en',
  target_locale TEXT NOT NULL,
  source_term TEXT NOT NULL,
  target_term TEXT NOT NULL,
  part_of_speech TEXT, -- 'noun', 'verb', 'brand', 'technical'
  description TEXT, -- Usage guidance for translators / AI
  case_sensitive BOOLEAN NOT NULL DEFAULT false,
  forbidden BOOLEAN NOT NULL DEFAULT false, -- If true, target_term must NEVER be used
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX pub_glossary_term_idx ON publication_glossaries (
  publication_id, source_locale, target_locale, LOWER(source_term)
);

-- 2. Translation Memory (TM Units)
CREATE TABLE translation_memory_units (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  source_segment TEXT NOT NULL,
  target_segment TEXT NOT NULL,
  source_hash TEXT NOT NULL, -- SHA-256 for O(1) exact match lookups
  domain_tag TEXT DEFAULT 'general',
  quality_score INTEGER DEFAULT 100, -- Verified human approval = 100
  usage_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tm_units_lookup_idx ON translation_memory_units (
  publication_id, source_locale, target_locale, source_hash
);

CREATE INDEX tm_units_fuzzy_idx ON translation_memory_units USING gin (
  source_segment gin_trgm_ops
);
```

---

## 4. Translation Memory (TM) Matching Engine

### Segment Lookup Lifecycle
When an editor or AI initiates translation of an article:
1. **Segmentation**: Document body text is parsed into discrete sentences using standard Unicode sentence boundary rules (`Intl.Segmenter(sourceLocale, { granularity: 'sentence' })`).
2. **Exact Match Check (100% Match)**:
   - Compute SHA-256 of normalized source sentence.
   - If found in `translation_memory_units`, automatically insert the target segment (marked `status = 'tm_exact'`).
3. **Fuzzy Match Check (70% - 99% Match)**:
   - Execute trigram similarity search:
     ```sql
     SELECT target_segment, similarity(source_segment, :sentence) AS score
     FROM translation_memory_units
     WHERE publication_id = :pubId AND similarity(source_segment, :sentence) >= 0.70
     ORDER BY score DESC LIMIT 1;
     ```
   - Present fuzzy suggestion in Admin Translation Editor with visual diff highlighting substituted words.
4. **New Translation Storage**:
   - When a human editor approves a translation in the Review Queue, all segmented sentence pairs are upserted into `translation_memory_units`.

---

## 5. Automated Translation Quality Scoring (0 - 100)

Every translation receives an automated quality score before reaching the review queue:

$$\text{Quality Score} = 0.4 \times Q_{\text{glossary}} + 0.3 \times Q_{\text{formatting}} + 0.3 \times Q_{\text{semantics}}$$

1. **$Q_{\text{glossary}}$ (Glossary Adherence)**:
   - Evaluates whether all glossary terms found in the source text appear correctly translated in the target text. Score drops by 20 points for each omitted or altered glossary term.
2. **$Q_{\text{formatting}}$ (Tag & Link Balance)**:
   - Verifies that all hyperlinks, bold spans, and formatting markers in the source Lexical AST have corresponding pairs in the target AST.
3. **$Q_{\text{semantics}}$ (Length & Structure Ratio)**:
   - Flags anomalies where target text is unnaturally short (<50% of source) or unnaturally bloated (>200% of source).

---

## 6. Two-Tier Editorial Review Workflow in Admin

1. **Translator Role**:
   - Translators can edit translations assigned to them (`assigned_translator_id = currentUser.id`).
   - Can trigger AI segment completions adhering strictly to glossary terms.
   - When finished, translator clicks **"Submit for Review"** (`status → 'needs_review'`).
2. **Editor / Publisher Approval**:
   - Senior Editors view the **Translation Review Queue** (`apps/admin/src/components/translations/TranslationReviewQueue.tsx`).
   - Side-by-side bilingual view with tracked changes and quality score badge.
   - Actions: **"Approve & Publish"** (`status → 'published'`) or **"Request Changes"** with inline comments.
