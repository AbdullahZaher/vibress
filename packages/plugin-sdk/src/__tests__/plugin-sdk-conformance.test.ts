import { describe, it, expect } from "vitest";
import {
  definePlugin,
  defineNativeAdminPageV1,
  defineNativeAdminResourceV1,
  defineNativeAdminActionV1,
  defineNativeDomainWorkflowV1,
  defineSettingsSchema,
  resolveLocalizedLabel,
  maskSecretValue,
  SDK_VERSION,
} from "../index";

describe("M3: @vibress/plugin-sdk Developer Experience and Public Contracts Conformance", () => {
  it("SDK-02: definePlugin strictly validates manifest and retains typed definitions", () => {
    const plugin = definePlugin({
      manifest: {
        id: "analytics-suite",
        name: "Analytics Suite",
        version: "1.0.0",
        vibressApiVersion: SDK_VERSION,
        entrypoint: "index.js",
        capabilities: ["content.read", "admin.navigation"],
      },
      activate: async (ctx) => {
        ctx.log("Analytics activated");
      },
    });

    expect(plugin.manifest.id).toBe("analytics-suite");
    expect(plugin.manifest.capabilities).toContain("admin.navigation");

    // Invalid manifest (wrong API version) fails immediately
    expect(() => definePlugin({
      manifest: {
        id: "bad-plugin",
        name: "Bad Plugin",
        version: "1.0.0",
        vibressApiVersion: "0.0.1",
        entrypoint: "index.js",
        capabilities: ["content.read"],
      },
    })).toThrow(/Unsupported Vibress API version/);

    // Invalid manifest (relative path escape) fails immediately
    expect(() => definePlugin({
      manifest: {
        id: "bad-plugin",
        name: "Bad Plugin",
        version: "1.0.0",
        vibressApiVersion: SDK_VERSION,
        entrypoint: "../../../etc/passwd",
        capabilities: ["content.read"],
      },
    })).toThrow(/safe relative path/);
  });

  it("SDK-NUI-05: resolveLocalizedLabel supports BCP-47 locale negotiation and graceful fallback", () => {
    const label = {
      en: "Course Overview",
      ar: "نظرة عامة على الدورة",
      "fr-CA": "Aperçu du cours (Québec)",
      fr: "Aperçu du cours",
    };

    // Exact match
    expect(resolveLocalizedLabel(label, "ar")).toBe("نظرة عامة على الدورة");
    expect(resolveLocalizedLabel(label, "fr-CA")).toBe("Aperçu du cours (Québec)");

    // Language prefix fallback: "fr-FR" -> "fr"
    expect(resolveLocalizedLabel(label, "fr-FR")).toBe("Aperçu du cours");

    // Regional fallback: "ar-EG" -> "ar"
    expect(resolveLocalizedLabel(label, "ar-EG")).toBe("نظرة عامة على الدورة");

    // Default English fallback when language is unprovided
    expect(resolveLocalizedLabel(label, "de")).toBe("Course Overview");
    expect(resolveLocalizedLabel(label, "zh-CN")).toBe("Course Overview");

    // Plain string backward compatibility
    expect(resolveLocalizedLabel("Static Title")).toBe("Static Title");
  });

  it("SDK-NUI-06: settings schema definition and secret value masking", () => {
    const schema = defineSettingsSchema({
      version: 1,
      fields: [
        {
          key: "api_key",
          type: "secret",
          label: { en: "API Key", ar: "مفتاح API" },
          isSecret: true,
          required: true,
        },
        {
          key: "header_image",
          type: "media",
          label: { en: "Header Image", ar: "صورة الترويسة" },
          mediaAllowedTypes: ["image"],
        },
        {
          key: "sync_interval",
          type: "number",
          label: { en: "Sync Interval", ar: "فاصل المزامنة" },
          defaultValue: 300,
        },
      ],
    });

    expect(schema.version).toBe(1);
    expect(schema.fields).toHaveLength(3);
    expect(schema.fields[0].isSecret).toBe(true);

    // Secret masking
    expect(maskSecretValue("sk_live_1234567890abcdef")).toBe("sk••••••••ef");
    expect(maskSecretValue("test")).toBe("••••");
    expect(maskSecretValue("")).toBe("");
    expect(maskSecretValue(null)).toBe("");
  });

  it("SDK-NUI-01..04: defines Native Admin page, data resource, action, and domain workflow descriptors", () => {
    const page = defineNativeAdminPageV1({
      schemaVersion: 1,
      viewId: "courses-overview",
      title: { en: "Courses", ar: "الدورات التعليمية" },
      components: [
        {
          type: "stat",
          id: "total-students",
          label: { en: "Total Students", ar: "إجمالي الطلاب" },
          field: "student_count",
        },
        {
          type: "field-list",
          id: "summary-fields",
          fields: [
            { key: "active_courses", label: { en: "Active Courses", ar: "الدورات النشطة" } },
          ],
        },
      ],
    });
    expect(page.viewId).toBe("courses-overview");

    const resource = defineNativeAdminResourceV1({
      id: "courses-resource",
      modelKey: "courses",
      fields: ["title", "instructor", "enrollment_count"],
      textFilters: ["title"],
    });
    expect(resource.modelKey).toBe("courses");

    const action = defineNativeAdminActionV1({
      id: "create-course",
      resourceId: "courses-resource",
      operation: "create",
    });
    expect(action.operation).toBe("create");

    const workflow = defineNativeDomainWorkflowV1({
      schemaVersion: 1,
      viewId: "courses-overview",
      routeId: "courses",
      resourceId: "courses-resource",
      idField: "id",
      versionField: "version",
      operationField: "operation",
      fields: [
        {
          key: "title",
          label: { en: "Title", ar: "العنوان" },
          maxLength: 120,
        },
      ],
      operations: ["create", "save", "publish"],
    });
    expect(workflow.operations).toEqual(["create", "save", "publish"]);
  });
});
