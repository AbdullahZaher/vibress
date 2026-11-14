import { createHash } from "node:crypto";
import {
  assertStudioDocumentEditable,
  validateStudioDocument,
  type StudioDocument,
} from "@vibress/studio-core";

/**
 * Pinned two-publication CMS/Studio compatibility fixture pack (W1-T08).
 *
 * Every document and publication template below is versioned data. The
 * SHA-256 digest pins the exact contents: editing the pack without updating
 * `CMS_STUDIO_FIXTURE_PACK_DIGEST` makes `loadCmsStudioFixturePack()` fail
 * closed, so compatibility tests cannot silently drift with the CMS.
 *
 * Run-scoped identities (slugs, domains, emails) are derived by the
 * provisioner; they are deliberately not part of the digest.
 */
export const CMS_STUDIO_FIXTURE_PACK_SCHEMA = "vibress-cms-studio-fixture-pack";
export const CMS_STUDIO_FIXTURE_PACK_VERSION = 1;

export type CmsStudioFixturePublicationKey = "primary" | "secondary";
export type CmsStudioFixtureKind = "post" | "page";

export interface CmsStudioFixturePublication {
  readonly key: CmsStudioFixturePublicationKey;
  readonly name: string;
  readonly slugBase: string;
  readonly domainBase: string;
  readonly primaryLocale: "en" | "ar";
  readonly staff: {
    readonly name: string;
    readonly emailBase: string;
  };
}

export interface CmsStudioFixtureEntry {
  readonly key: string;
  readonly publicationKey: CmsStudioFixturePublicationKey;
  readonly kind: CmsStudioFixtureKind;
  readonly title: string;
  readonly slugBase: string;
  readonly document: StudioDocument;
}

export interface CmsStudioFixturePack {
  readonly schema: typeof CMS_STUDIO_FIXTURE_PACK_SCHEMA;
  readonly version: typeof CMS_STUDIO_FIXTURE_PACK_VERSION;
  readonly publications: readonly CmsStudioFixturePublication[];
  readonly content: readonly CmsStudioFixtureEntry[];
}

export class CmsStudioFixturePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CmsStudioFixturePackError";
  }
}

export const CMS_STUDIO_FIXTURE_PACK: CmsStudioFixturePack = {
  schema: CMS_STUDIO_FIXTURE_PACK_SCHEMA,
  version: CMS_STUDIO_FIXTURE_PACK_VERSION,
  publications: [
    {
      key: "primary",
      name: "Pinned Fixture Primary",
      slugBase: "fixture-primary",
      domainBase: "primary.fixture.vibress.test",
      primaryLocale: "en",
      staff: { name: "Primary Fixture Staff", emailBase: "fixture.primary" },
    },
    {
      key: "secondary",
      name: "Pinned Fixture Secondary",
      slugBase: "fixture-secondary",
      domainBase: "secondary.fixture.vibress.test",
      primaryLocale: "ar",
      staff: { name: "Secondary Fixture Staff", emailBase: "fixture.secondary" },
    },
  ],
  content: [
    {
      key: "primary-post",
      publicationKey: "primary",
      kind: "post",
      title: "Pinned compatibility note",
      slugBase: "pinned-compatibility-note",
      document: {
        schema: "vibress-studio",
        version: 1,
        editor: { lexicalVersion: "0.13.1" },
        root: {
          type: "root",
          direction: null,
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "heading",
              tag: "h2",
              direction: null,
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  type: "text",
                  text: "Pinned compatibility note",
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
            {
              type: "paragraph",
              direction: "ltr",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  type: "text",
                  text: "Primary publication · pinned Studio fixture.",
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
            {
              type: "studio-card",
              cardType: "callout",
              cardData: {
                tone: "info",
                body: "Canonical cards persist as studio-card.",
              },
              version: 1,
            },
          ],
        },
      },
    },
    {
      key: "secondary-post",
      publicationKey: "secondary",
      kind: "post",
      title: "ملاحظة توافق مثبتة",
      slugBase: "pinned-compatibility-note",
      document: {
        schema: "vibress-studio",
        version: 1,
        editor: { lexicalVersion: "0.13.1" },
        root: {
          type: "root",
          direction: "rtl",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "heading",
              tag: "h2",
              direction: "rtl",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  type: "text",
                  text: "ملاحظة توافق مثبتة",
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
            {
              type: "paragraph",
              direction: "rtl",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  type: "text",
                  text: "منشور ثانوي · محتوى عربي مثبت. Secondary fixture text.",
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
          ],
        },
      },
    },
    {
      key: "primary-page",
      publicationKey: "primary",
      kind: "page",
      title: "Pinned fixture page",
      slugBase: "pinned-fixture-page",
      document: {
        schema: "vibress-studio",
        version: 1,
        editor: { lexicalVersion: "0.13.1" },
        root: {
          type: "root",
          direction: null,
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              direction: null,
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  type: "text",
                  text: "Pinned page fixture — english line.",
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
                { type: "linebreak", version: 1 },
                {
                  type: "text",
                  text: "سطر عربي مثبت في الصفحة.",
                  format: 0,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

/** SHA-256 of the stable JSON encoding of the pinned pack contents. */
export const CMS_STUDIO_FIXTURE_PACK_DIGEST =
  "83736be82f4d7302cc6c3dbe4d4fc2df4a23c0897dd99ce238ab5766cee147c7";

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function computeCmsStudioFixturePackDigest(
  pack: CmsStudioFixturePack = CMS_STUDIO_FIXTURE_PACK,
): string {
  return createHash("sha256").update(stableStringify(pack)).digest("hex");
}

/**
 * Loads and verifies the pinned pack. Fails closed on any digest drift,
 * structural inconsistency, or document the host editor cannot safely rewrite.
 */
export function loadCmsStudioFixturePack(): CmsStudioFixturePack {
  return verifyCmsStudioFixturePack(CMS_STUDIO_FIXTURE_PACK);
}

export function verifyCmsStudioFixturePack(
  pack: CmsStudioFixturePack,
  expectedDigest: string = CMS_STUDIO_FIXTURE_PACK_DIGEST,
): CmsStudioFixturePack {
  if (pack.schema !== CMS_STUDIO_FIXTURE_PACK_SCHEMA) {
    throw new CmsStudioFixturePackError(
      `Unrecognized fixture pack schema: ${String(pack.schema)}`,
    );
  }
  if (pack.version !== CMS_STUDIO_FIXTURE_PACK_VERSION) {
    throw new CmsStudioFixturePackError(
      `Unsupported fixture pack version: ${String(pack.version)}`,
    );
  }
  const digest = computeCmsStudioFixturePackDigest(pack);
  if (digest !== expectedDigest) {
    throw new CmsStudioFixturePackError(
      `Fixture pack digest mismatch (pinned ${CMS_STUDIO_FIXTURE_PACK_DIGEST}, computed ${digest}); update the digest only with a reviewed pack change.`,
    );
  }
  const publicationKeys = new Set(pack.publications.map((entry) => entry.key));
  if (publicationKeys.size !== pack.publications.length) {
    throw new CmsStudioFixturePackError("Fixture pack publication keys must be unique.");
  }
  for (const key of ["primary", "secondary"] as const) {
    if (!publicationKeys.has(key)) {
      throw new CmsStudioFixturePackError(`Fixture pack is missing the ${key} publication.`);
    }
  }
  const entryKeys = new Set<string>();
  for (const entry of pack.content) {
    if (entryKeys.has(entry.key)) {
      throw new CmsStudioFixturePackError(`Duplicate fixture content key: ${entry.key}`);
    }
    entryKeys.add(entry.key);
    if (!publicationKeys.has(entry.publicationKey)) {
      throw new CmsStudioFixturePackError(
        `Fixture content ${entry.key} references unknown publication ${entry.publicationKey}`,
      );
    }
    validateStudioDocument(entry.document);
    assertStudioDocumentEditable(entry.document);
  }
  return pack;
}
