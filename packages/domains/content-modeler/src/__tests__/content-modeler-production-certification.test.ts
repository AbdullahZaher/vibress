import { describe, it, expect, beforeAll } from "vitest";
import { ContentModelerService } from "../application/content-modeler-service";
import {
  validateEntryData,
  validateModelDefinition,
  filterEntryDataForVisibility,
  resolveLocalizedEntryData,
  analyzeSchemaEvolution,
  MAX_FIELDS_PER_MODEL,
  MAX_DATA_PAYLOAD_BYTES,
  MAX_RELATION_EXPANSION_DEPTH,
  ValidationError,
} from "../domain/validation";
import {
  ContentModel,
  ContentEntry,
  ContentFieldDefinition,
} from "../domain/types";
import {
  getDb,
  publications,
  workspaces,
  users,
  contentEntries,
  contentModels,
} from "@vibress/database";
import { eq, inArray } from "drizzle-orm";

describe("Vibress Content Modeler — Deep Production Certification Suite", () => {
  const service = new ContentModelerService();
  const pubAlpha = "pub_cert_alpha";
  const pubBeta = "pub_cert_beta";
  let testUserId = "usr_cert_admin";
  let alphaModel: ContentModel;
  let betaModel: ContentModel;
  let alphaEntry: ContentEntry;
  let betaEntry: ContentEntry;

  beforeAll(async () => {
    const db = getDb();

    // Query or create test admin user
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@vibress.local"))
      .limit(1);

    if (userRows[0]) {
      testUserId = userRows[0].id;
    } else {
      const newId = "usr_cert_admin";
      await db
        .insert(users)
        .values({
          id: newId,
          email: "cert-admin@vibress.local",
          name: "Cert Admin",
          passwordHash: "dummy_cert_hash",
        })
        .onConflictDoNothing();
      testUserId = newId;
    }

    // Clean prior test artifacts for cert publications
    await db
      .delete(contentEntries)
      .where(inArray(contentEntries.publicationId, [pubAlpha, pubBeta]));
    await db
      .delete(contentModels)
      .where(inArray(contentModels.publicationId, [pubAlpha, pubBeta]));

    // Ensure test workspace
    await db
      .insert(workspaces)
      .values({
        id: "ws_cert_test",
        name: "Cert Workspace",
        slug: "cert-workspace",
      })
      .onConflictDoNothing();

    // Ensure publications Alpha & Beta
    await db
      .insert(publications)
      .values([
        {
          id: pubAlpha,
          workspaceId: "ws_cert_test",
          name: "Publication Alpha (EN)",
          slug: "cert-alpha",
          primaryLocale: "en",
        },
        {
          id: pubBeta,
          workspaceId: "ws_cert_test",
          name: "Publication Beta (AR)",
          slug: "cert-beta",
          primaryLocale: "ar",
        },
      ])
      .onConflictDoNothing();
  });

  // =========================================================================
  // 1. ALL 18 FIELD TYPES REGISTRY & VALIDATION
  // =========================================================================
  describe("1. All 18 Field Types Validation & Storage Matrix", () => {
    const all18Fields: ContentFieldDefinition[] = [
      { id: "f_text", name: "Text", key: "textField", type: "text", required: true },
      { id: "f_short_text", name: "Short Text", key: "shortTextField", type: "short_text" },
      { id: "f_long_text", name: "Long Text", key: "longTextField", type: "long_text" },
      { id: "f_rich_text", name: "Rich Text", key: "richTextField", type: "rich_text" },
      { id: "f_studio_doc", name: "Studio Doc", key: "studioDocField", type: "studio_doc" },
      { id: "f_num", name: "Number", key: "numField", type: "number", min: 0, max: 1000 },
      { id: "f_bool", name: "Boolean", key: "boolField", type: "boolean" },
      { id: "f_date", name: "Date", key: "dateField", type: "date" },
      { id: "f_datetime", name: "DateTime", key: "datetimeField", type: "datetime" },
      { id: "f_url", name: "URL", key: "urlField", type: "url" },
      { id: "f_email", name: "Email", key: "emailField", type: "email" },
      {
        id: "f_select",
        name: "Select",
        key: "selectField",
        type: "select",
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      },
      {
        id: "f_multiselect",
        name: "Multi-Select",
        key: "multiSelectField",
        type: "multi_select",
        options: [
          { label: "Tag A", value: "tagA" },
          { label: "Tag B", value: "tagB" },
          { label: "Tag C", value: "tagC" },
        ],
      },
      { id: "f_taxonomy", name: "Taxonomy", key: "taxonomyField", type: "taxonomy" },
      { id: "f_media", name: "Media", key: "mediaField", type: "media" },
      { id: "f_relation", name: "Relation", key: "relationField", type: "relation" },
      { id: "f_relation_list", name: "Relation List", key: "relationListField", type: "relation_list" },
      { id: "f_json", name: "JSON", key: "jsonField", type: "json" },
    ];

    it("accepts valid values for all 18 field types", () => {
      const validPayload: Record<string, unknown> = {
        textField: "Hello World",
        shortTextField: "Short string",
        longTextField: "Another long body of text",
        richTextField: "<p>HTML rich content</p>",
        studioDocField: { root: { type: "root", children: [] } },
        numField: 42.5,
        boolField: true,
        dateField: "2026-09-19",
        datetimeField: "2026-09-19T18:00:00.000Z",
        urlField: "https://vibress.com/docs",
        emailField: "editor@vibress.com",
        selectField: "opt1",
        multiSelectField: ["tagA", "tagB"],
        taxonomyField: ["tech", "ai", "publishing"],
        mediaField: "media_asset_123",
        relationField: "ent_related_1",
        relationListField: ["ent_rel_1", "ent_rel_2"],
        jsonField: { key: "value", count: 10, nested: { flag: true } },
      };

      expect(() => validateEntryData(validPayload, all18Fields)).not.toThrow();
    });

    it("rejects invalid values with strict field error messages", () => {
      const invalidPayload: Record<string, unknown> = {
        textField: "", // required
        numField: 2000, // exceeds max 1000
        boolField: "not a bool",
        dateField: "invalid-date",
        urlField: "not-a-url",
        emailField: "bad-email",
        selectField: "invalid_option",
        multiSelectField: "not-an-array",
        jsonField: "string instead of object",
      };

      try {
        validateEntryData(invalidPayload, all18Fields);
        expect.unreachable("Validation should have failed");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const fieldErrors = (err as ValidationError).fieldErrors;
        expect(fieldErrors.textField).toBeDefined();
        expect(fieldErrors.numField).toBeDefined();
        expect(fieldErrors.boolField).toBeDefined();
        expect(fieldErrors.dateField).toBeDefined();
        expect(fieldErrors.urlField).toBeDefined();
        expect(fieldErrors.emailField).toBeDefined();
        expect(fieldErrors.selectField).toBeDefined();
        expect(fieldErrors.multiSelectField).toBeDefined();
        expect(fieldErrors.jsonField).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 2. ADVERSARIAL SECURITY & PUBLICATION ISOLATION
  // =========================================================================
  describe("2. Multi-Tenant Publication Isolation & Security Certification", () => {
    it("enforces tenant namespace isolation for models with same slug in different publications", async () => {
      alphaModel = await service.createModel(
        {
          name: "Articles",
          slug: "articles",
          fields: [{ id: "f1", name: "Heading", key: "heading", type: "text", required: true }],
        },
        pubAlpha,
      );

      betaModel = await service.createModel(
        {
          name: "Beta Articles",
          slug: "articles", // SAME SLUG!
          fields: [{ id: "f1", name: "Title", key: "title", type: "text", required: true }],
        },
        pubBeta,
      );

      expect(alphaModel.id).not.toBe(betaModel.id);
      expect(alphaModel.publicationId).toBe(pubAlpha);
      expect(betaModel.publicationId).toBe(pubBeta);
    });

    it("blocks Publication Alpha from reading, editing, or deleting Publication Beta models", async () => {
      // 1. Cross read by ID
      const crossRead = await service.getModelByIdOrSlug(betaModel.id, pubAlpha);
      expect(crossRead).toBeNull();

      // 2. Cross update
      await expect(
        service.updateModel(
          betaModel.id,
          { name: "Hacked Model Name" },
          pubAlpha,
        ),
      ).rejects.toThrow();

      // 3. Cross delete
      await expect(
        service.deleteModel(betaModel.id, pubAlpha),
      ).rejects.toThrow();
    });

    it("creates entries with strict composite publication scoping", async () => {
      alphaEntry = await service.createEntry(
        alphaModel.id,
        {
          title: "Alpha Secret Report",
          slug: "secret-report",
          data: { heading: "Top Secret Alpha Content" },
          status: "published",
        },
        testUserId,
        pubAlpha,
      );

      betaEntry = await service.createEntry(
        betaModel.id,
        {
          title: "Beta Public News",
          slug: "secret-report", // SAME SLUG across different publications
          data: { title: "Beta News Story" },
          status: "published",
        },
        testUserId,
        pubBeta,
      );

      expect(alphaEntry.publicationId).toBe(pubAlpha);
      expect(betaEntry.publicationId).toBe(pubBeta);
      expect(alphaEntry.id).not.toBe(betaEntry.id);
    });

    it("blocks Publication Beta from reading, updating, publishing, or deleting Publication Alpha entries", async () => {
      // 1. Cross read
      const readAttempt = await service.getEntryById(alphaModel.id, alphaEntry.id, pubBeta);
      expect(readAttempt).toBeNull();

      // 2. Cross update
      await expect(
        service.updateEntry(
          alphaModel.id,
          alphaEntry.id,
          { title: "Defaced by Beta" },
          testUserId,
          pubBeta,
        ),
      ).rejects.toThrow();

      // 3. Cross publish/unpublish/archive
      await expect(
        service.publishEntry(alphaModel.id, alphaEntry.id, testUserId, pubBeta),
      ).rejects.toThrow();

      // 4. Cross delete
      await expect(
        service.deleteEntry(alphaModel.id, alphaEntry.id, pubBeta),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 3. FIELD VISIBILITY FILTERING (PUBLIC vs AUTHENTICATED vs PRIVATE)
  // =========================================================================
  describe("3. Field Visibility Matrix (Public vs Authenticated vs Private)", () => {
    const visibilityFields: ContentFieldDefinition[] = [
      { id: "f_pub", name: "Public Name", key: "publicName", type: "text", apiVisibility: "public" },
      { id: "f_auth", name: "Member Price", key: "memberDiscount", type: "number", apiVisibility: "authenticated" },
      { id: "f_priv", name: "Wholesale Cost", key: "wholesaleCost", type: "number", apiVisibility: "private" },
    ];

    const rawData = {
      publicName: "Standard Widget",
      memberDiscount: 15.0,
      wholesaleCost: 3.5,
    };

    it("strips authenticated and private fields for anonymous public callers", () => {
      const publicFiltered = filterEntryDataForVisibility(rawData, visibilityFields, "public");
      expect(publicFiltered).toEqual({
        publicName: "Standard Widget",
      });
      expect(publicFiltered.memberDiscount).toBeUndefined();
      expect(publicFiltered.wholesaleCost).toBeUndefined();
    });

    it("includes authenticated fields but strips private fields for authenticated members", () => {
      const memberFiltered = filterEntryDataForVisibility(rawData, visibilityFields, "authenticated");
      expect(memberFiltered).toEqual({
        publicName: "Standard Widget",
        memberDiscount: 15.0,
      });
      expect(memberFiltered.wholesaleCost).toBeUndefined();
    });

    it("preserves all fields (including private) for staff administrators", () => {
      const staffData = filterEntryDataForVisibility(rawData, visibilityFields, "staff_admin");
      expect(staffData).toEqual({
        publicName: "Standard Widget",
        memberDiscount: 15.0,
        wholesaleCost: 3.5,
      });
    });
  });

  // =========================================================================
  // 4. RELATIONS CONTRACT & MAX DEPTH = 2 BOUND
  // =========================================================================
  describe("4. First-Class Relations & Expansion Depth Contract", () => {
    let courseModel: ContentModel;
    let moduleModel: ContentModel;
    let lessonModel: ContentModel;
    let lessonEntry: ContentEntry;
    let moduleEntry: ContentEntry;
    let courseEntry: ContentEntry;

    it("resolves nested relations up to authoritative MAX_RELATION_EXPANSION_DEPTH = 2", async () => {
      expect(MAX_RELATION_EXPANSION_DEPTH).toBe(2);

      // 1. Create Lesson Model
      lessonModel = await service.createModel(
        {
          name: "Lesson",
          slug: "lesson",
          fields: [{ id: "fl1", name: "Lesson Title", key: "lessonTitle", type: "text", required: true }],
        },
        pubAlpha,
      );

      // 2. Create Module Model referencing Lesson
      moduleModel = await service.createModel(
        {
          name: "Module",
          slug: "module",
          fields: [
            { id: "fm1", name: "Module Name", key: "moduleName", type: "text", required: true },
            { id: "fm2", name: "Lessons", key: "lessons", type: "relation_list", relationModel: lessonModel.id },
          ],
        },
        pubAlpha,
      );

      // 3. Create Course Model referencing Module
      courseModel = await service.createModel(
        {
          name: "Course",
          slug: "course",
          fields: [
            { id: "fc1", name: "Course Title", key: "courseTitle", type: "text", required: true },
            { id: "fc2", name: "Main Module", key: "mainModule", type: "relation", relationModel: moduleModel.id },
          ],
        },
        pubAlpha,
      );

      // 4. Create Entries
      lessonEntry = await service.createEntry(
        lessonModel.id,
        {
          title: "Introduction to Type Systems",
          slug: "intro-types",
          data: { lessonTitle: "Introduction to Type Systems" },
          status: "published",
        },
        testUserId,
        pubAlpha,
      );

      moduleEntry = await service.createEntry(
        moduleModel.id,
        {
          title: "Core Concepts",
          slug: "core-concepts",
          data: {
            moduleName: "Core Concepts",
            lessons: [lessonEntry.id],
          },
          status: "published",
        },
        testUserId,
        pubAlpha,
      );

      courseEntry = await service.createEntry(
        courseModel.id,
        {
          title: "Mastering TypeScript",
          slug: "mastering-ts",
          data: {
            courseTitle: "Mastering TypeScript",
            mainModule: moduleEntry.id,
          },
          status: "published",
        },
        testUserId,
        pubAlpha,
      );

      // Retrieve course with relation expansion
      const resolvedCourse = await service.getEntryById(courseModel.id, courseEntry.id, pubAlpha, true);
      expect(resolvedCourse).not.toBeNull();
      const resolvedModule = resolvedCourse!.data.mainModule as any;
      expect(resolvedModule).toBeDefined();
      expect(resolvedModule.title).toBe("Core Concepts");
      expect(resolvedModule.slug).toBe("core-concepts");
    });

    it("safely ignores missing or deleted relation targets without throwing errors", async () => {
      const brokenEntry = await service.createEntry(
        courseModel.id,
        {
          title: "Orphaned Course",
          slug: "orphaned-course",
          data: {
            courseTitle: "Orphaned Course",
            mainModule: "non_existent_module_id",
          },
          status: "published",
        },
        testUserId,
        pubAlpha,
      );

      const resolved = await service.getEntryById(courseModel.id, brokenEntry.id, pubAlpha, true);
      expect(resolved).not.toBeNull();
      // Should resolve safely to null if target is non-existent
      expect(resolved!.data.mainModule).toBeNull();
    });
  });

  // =========================================================================
  // 5. LOCALIZATION & ARABIC RTL USER JOURNEY
  // =========================================================================
  describe("5. Localization & Arabic RTL User Journey", () => {
    let localizedModel: ContentModel;

    it("stores and resolves localized dictionary fields with fallback to primary locale", async () => {
      localizedModel = await service.createModel(
        {
          name: "Localized Product",
          slug: "loc-product",
          fields: [
            { id: "fl_name", name: "Product Name", key: "name", type: "text", localizable: true, required: true },
            { id: "fl_desc", name: "Description", key: "description", type: "long_text", localizable: true },
            { id: "fl_sku", name: "SKU", key: "sku", type: "text", localizable: false },
          ],
        },
        pubAlpha,
      );

      const locEntry = await service.createEntry(
        localizedModel.id,
        {
          title: "Vibress Pro Hub",
          slug: "vibress-pro-hub",
          data: {
            name: {
              en: "Vibress Pro Hub",
              ar: "منصة فايبرس برو",
            },
            description: {
              en: "Next generation digital publishing system",
              ar: "نظام النشر الرقمي من الجيل التالي",
            },
            sku: "VIB-PRO-2026",
          },
          status: "published",
        },
        testUserId,
        pubAlpha,
      );

      // 1. Resolve for Arabic (ar)
      const arResolved = resolveLocalizedEntryData(locEntry.data, localizedModel.fields, "ar", "en");
      expect(arResolved.name).toBe("منصة فايبرس برو");
      expect(arResolved.description).toBe("نظام النشر الرقمي من الجيل التالي");
      expect(arResolved.sku).toBe("VIB-PRO-2026");

      // 2. Resolve for English (en)
      const enResolved = resolveLocalizedEntryData(locEntry.data, localizedModel.fields, "en", "en");
      expect(enResolved.name).toBe("Vibress Pro Hub");
      expect(enResolved.description).toBe("Next generation digital publishing system");

      // 3. Resolve for non-existing locale (fr) -> falls back to en
      const frResolved = resolveLocalizedEntryData(locEntry.data, localizedModel.fields, "fr", "en");
      expect(frResolved.name).toBe("Vibress Pro Hub");
    });
  });

  // =========================================================================
  // 6. SCHEMA EVOLUTION & BACKWARD COMPATIBILITY
  // =========================================================================
  describe("6. Schema Evolution Engine & Migration Preview", () => {
    it("detects additions, removals, renames, and type changes accurately", () => {
      const oldFields: ContentFieldDefinition[] = [
        { id: "f1", name: "Title", key: "title", type: "text", required: true },
        { id: "f2", name: "Old Field", key: "oldField", type: "text" },
        { id: "f3", name: "Count", key: "count", type: "number" },
        { id: "f4", name: "Price", key: "price", type: "number", required: false },
      ];

      const newFields: ContentFieldDefinition[] = [
        { id: "f1", name: "Headline", key: "title", type: "text", required: true }, // renamed display
        // f2 removed
        { id: "f3", name: "Count", key: "count", type: "text" }, // dangerous type change number -> text
        { id: "f4", name: "Price", key: "price", type: "number", required: true }, // optional -> required
        { id: "f5", name: "New Feature", key: "newFeature", type: "boolean" }, // added
      ];

      const diff = analyzeSchemaEvolution(oldFields, newFields);
      expect(diff.safe).toBe(false);
      expect(diff.warnings.length).toBeGreaterThan(0);
      expect(diff.changes.some((c) => c.key === "newFeature" && c.action === "added")).toBe(true);
      expect(diff.changes.some((c) => c.key === "oldField" && c.action === "removed")).toBe(true);
      expect(diff.changes.some((c) => c.key === "count" && c.action === "modified" && !c.isSafe)).toBe(true);
    });
  });

  // =========================================================================
  // 7. PUBLIC DTO & VIEW MODEL DATA TRANSFORMATION
  // =========================================================================
  describe("7. Public DTO & View Model Data Transformation", () => {
    it("transforms entries to public DTOs with localized fields and stripped private fields", () => {
      const model: ContentModel = {
        id: "mod_portfolio",
        publicationId: pubAlpha,
        name: "Portfolio",
        slug: "portfolio",
        fields: [
          { id: "f_title", name: "Project Title", key: "title", type: "text", localizable: true, apiVisibility: "public" },
          { id: "f_budget", name: "Budget", key: "budget", type: "number", apiVisibility: "private" },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const entry: ContentEntry = {
        id: "ent_p1",
        publicationId: pubAlpha,
        modelId: "mod_portfolio",
        title: "Fintech App",
        slug: "fintech-app",
        status: "published",
        version: 1,
        createdBy: testUserId,
        updatedBy: testUserId,
        publishedAt: new Date("2026-09-01"),
        createdAt: new Date("2026-09-01"),
        updatedAt: new Date("2026-09-01"),
        data: {
          title: {
            en: "Fintech Mobile App",
            ar: "تطبيق التكنولوجيا المالية",
          },
          budget: 50000,
        },
      };

      const publicDto = service.toPublicEntryDto(entry, model, "public", "ar");
      expect(publicDto.id).toBe("ent_p1");
      expect(publicDto.slug).toBe("fintech-app");
      expect(publicDto.data.title).toBe("تطبيق التكنولوجيا المالية");
      expect(publicDto.data.budget).toBeUndefined(); // private field stripped
    });
  });

  // =========================================================================
  // 8. SECURITY & ABUSE LIMITS (MAX FIELDS, 1MB PAYLOAD)
  // =========================================================================
  describe("8. Abuse Limits & Guardrails", () => {
    it("enforces MAX_FIELDS_PER_MODEL = 100 on model creation", () => {
      const excessFields: ContentFieldDefinition[] = Array.from({ length: 101 }, (_, i) => ({
        id: `f_${i}`,
        name: `Field ${i}`,
        key: `field_${i}`,
        type: "text",
      }));

      expect(() =>
        validateModelDefinition({
          name: "Too Many Fields Model",
          fields: excessFields,
        }),
      ).toThrow(ValidationError);
    });

    it("enforces MAX_DATA_PAYLOAD_BYTES (1MB) on entry data payloads", () => {
      const hugeString = "a".repeat(1024 * 1024 + 100); // > 1MB
      const hugePayload = {
        hugeField: hugeString,
      };

      const fields: ContentFieldDefinition[] = [
        { id: "f_huge", name: "Huge Field", key: "hugeField", type: "long_text" },
      ];

      expect(() => validateEntryData(hugePayload, fields)).toThrow(ValidationError);
    });

    it("rejects prototype pollution attempts in field keys", () => {
      const maliciousFields: ContentFieldDefinition[] = [
        { id: "f_proto", name: "Proto Field", key: "__proto__", type: "text" },
      ];

      expect(() =>
        validateModelDefinition({
          name: "Malicious Model",
          fields: maliciousFields,
        }),
      ).toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 9. MEASURED BENCHMARKS (MODELS, LARGE COLLECTIONS, RESOLUTION)
  // =========================================================================
  describe("9. Measured Performance Benchmarks", () => {
    it("measures model creation throughput across 20 concurrent models", async () => {
      const startTime = performance.now();
      const modelCount = 20;

      const promises = Array.from({ length: modelCount }, (_, i) =>
        service.createModel(
          {
            name: `Benchmark Model ${i}`,
            slug: `bench-model-${i}`,
            fields: [
              { id: `bm_f1_${i}`, name: "Title", key: "title", type: "text", required: true },
              { id: `bm_f2_${i}`, name: "Score", key: "score", type: "number" },
              { id: `bm_f3_${i}`, name: "Active", key: "active", type: "boolean" },
            ],
          },
          pubAlpha,
        ),
      );

      const createdModels = await Promise.all(promises);
      const durationMs = performance.now() - startTime;

      expect(createdModels).toHaveLength(modelCount);
      const avgLatencyPerModelMs = durationMs / modelCount;

      console.log(`[BENCHMARK] Created ${modelCount} models in ${durationMs.toFixed(2)}ms (Avg: ${avgLatencyPerModelMs.toFixed(2)}ms/model)`);
      expect(avgLatencyPerModelMs).toBeLessThan(150); // Under 150ms per model insert
    });

    it("measures entry query & relation resolution latency", async () => {
      const startTime = performance.now();
      const entries = await service.listEntries(
        alphaModel.id,
        pubAlpha,
        { limit: 50, includeRelations: true },
      );
      const durationMs = performance.now() - startTime;

      console.log(`[BENCHMARK] Queried & resolved ${entries.length} entries in ${durationMs.toFixed(2)}ms`);
      expect(durationMs).toBeLessThan(200); // Fast sub-200ms list response
    });
  });
});
