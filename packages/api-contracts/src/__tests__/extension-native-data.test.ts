import { describe, expect, it } from "vitest";
import {
  ExtensionNativeDataRegistryV1Schema, ExtensionNativeActionBodyV1Schema,
  ExtensionNativeDataQueryV1Schema, ExtensionNativeDataPageV1Schema,
  ExtensionNativeDataDiscoveryV1Schema,
} from "../extension-native-data";

const resource = {
  id: "courses", modelKey: "courses",
  fields: ["title_en", "status"], textFilters: ["title_en"],
};
const action = { id: "course-create", resourceId: "courses", operation: "create" };
describe("NUI-03 storage-backed resource/action contracts", () => {
  it("admits bounded projections and CAS mutation payloads", () => {
    expect(ExtensionNativeDataRegistryV1Schema.safeParse({
      resources: [resource], actions: [action],
    }).success).toBe(true);
    expect(ExtensionNativeActionBodyV1Schema.safeParse({
      id: "course-1", expectedVersion: 3, fields: { title_en: "Valid" },
    }).success).toBe(true);
  });
  it("exposes only inert discovery metadata, never storage model IDs", () => {
    expect(ExtensionNativeDataDiscoveryV1Schema.safeParse({
      schemaVersion: 1,
      resources: [{ id: resource.id, viewId: "overview", fields: resource.fields,
        textFilters: resource.textFilters, fieldTypes: { title_en: "text", status: "text" },
        requiredFields: ["title_en"] }],
      actions: [action],
    }).success).toBe(true);
    expect(ExtensionNativeDataDiscoveryV1Schema.safeParse({
      schemaVersion: 1,
      resources: [resource], actions: [],
    }).success).toBe(false);
  });
  it("rejects arbitrary routes, permissions and unbound actions", () => {
    for (const value of [
      { resources: [{ ...resource, url: "https://evil.example" }], actions: [] },
      { resources: [resource], actions: [{ ...action, resourceId: "foreign" }] },
      { resources: [resource], actions: [{ ...action, permission: "posts.read" }] },
      { resources: [resource, resource], actions: [] },
    ]) expect(ExtensionNativeDataRegistryV1Schema.safeParse(value).success).toBe(false);
  });
  it("rejects authority selectors, duplicate projections and bad methods", () => {
    for (const value of [
      { ...resource, fields: ["title_en", "title_en"] },
      { ...resource, modelKey: "../escape" },
      { ...resource, textFilters: ["secret"] },
    ]) expect(ExtensionNativeDataRegistryV1Schema.safeParse({
      resources: [value], actions: [],
    }).success).toBe(false);
    expect(ExtensionNativeDataRegistryV1Schema.safeParse({
      resources: [resource], actions: [{ ...action, operation: "delete" }],
    }).success).toBe(false);
  });
  it("requires a record ID, bounded fields, and version for update at the Host", () => {
    for (const value of [
      { id: "../bad", fields: { title_en: "Safe" } },
      { id: "ok", fields: { publicationId: "foreign" } },
      { id: "ok", fields: { title_en: { nested: true } } },
      { id: "ok", fields: { title_en: "x".repeat(8193) } },
      { id: "ok", fields: { title_en: "Safe" }, unknown: "x" },
    ]) expect(ExtensionNativeActionBodyV1Schema.safeParse(value).success).toBe(false);
  });
  it("rejects foreign selectors, huge cursors and incomplete filters", () => {
    for (const query of [
      { publicationId: "foreign" }, { cursor: "x".repeat(1025) },
      { filterField: "title_en" }, { filterValue: "term" },
      { limit: "21" },
    ]) expect(ExtensionNativeDataQueryV1Schema.safeParse(query).success).toBe(false);
  });
  it("caps resource responses and does not admit malformed typed records", () => {
    expect(ExtensionNativeDataPageV1Schema.safeParse({
      schemaVersion: 1,
      items: [{ id: "course-1", version: 1, fields: { title_en: "OK" } }],
    }).success).toBe(true);
    expect(ExtensionNativeDataPageV1Schema.safeParse({
      schemaVersion: 1,
      items: [{ id: "course-1", version: 1, fields: { title_en: { x: "unsafe" } } }],
    }).success).toBe(false);
  });
});
