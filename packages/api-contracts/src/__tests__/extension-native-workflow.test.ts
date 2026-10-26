import { describe, expect, it } from "vitest";
import { ExtensionNativeDomainWorkflowV1Schema } from "../extension-native-workflow";

const label = { en: "Course", ar: "دورة" };
const workflow = {
  schemaVersion: 1, viewId: "course-overview", routeId: "courses",
  idField: "courseId", versionField: "expectedVersion", operationField: "operation",
  operations: ["create", "save", "publish"],
  fields: [{ key: "title_en", label, maxLength: 180 },
    { key: "lesson_body_ar", label, maxLength: 4096, multiline: true }],
};

describe("Native domain workflow v1 syntax", () => {
  it("admits bounded inert bilingual fields and operations", () => {
    expect(ExtensionNativeDomainWorkflowV1Schema.safeParse(workflow).success).toBe(true);
  });
  it("rejects executable properties and arbitrary operations", () => {
    for (const invalid of [
      { ...workflow, url: "https://evil.invalid" },
      { ...workflow, onSubmit: "alert(1)" },
      { ...workflow, operations: ["delete", "publish"] },
      { ...workflow, operations: ["save", "publish"] },
      { ...workflow, fields: [{ ...workflow.fields[0], html: "<script/>" }] },
      { ...workflow, fields: [{ ...workflow.fields[0], maxLength: 4097 }] },
    ]) expect(ExtensionNativeDomainWorkflowV1Schema.safeParse(invalid).success).toBe(false);
  });
  it("rejects duplicates, collisions, malformed localization and versions", () => {
    for (const invalid of [
      { ...workflow, fields: [workflow.fields[0], workflow.fields[0]] },
      { ...workflow, operationField: "title_en" },
      { ...workflow, operations: ["create", "save", "save"] },
      { ...workflow, schemaVersion: 2 },
      { ...workflow, fields: [{ key: "title_en", label: { en: "Title", ar: " " }, maxLength: 100 }] },
    ]) expect(ExtensionNativeDomainWorkflowV1Schema.safeParse(invalid).success).toBe(false);
  });
});
