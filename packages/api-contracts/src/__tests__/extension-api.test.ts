import { describe, expect, it } from "vitest";
import {
  ExtensionApiRouteSchema,
  ExtensionApiRouteParamsSchema,
  validateExtensionApiObject,
} from "../plugins";

const shape = {
  fields: { title: "string" as const, published: "boolean" as const },
  required: ["title"],
};
const adminRoute = {
  id: "courses",
  audience: "admin",
  method: "POST",
  permission: "posts.edit",
  body: shape,
  response: { fields: { id: "string" } },
};

describe("EXT-201 declarative extension route admission", () => {
  it("admits scoped named routes and rejects unknown metadata", () => {
    expect(ExtensionApiRouteSchema.safeParse(adminRoute).success).toBe(true);
    expect(ExtensionApiRouteSchema.safeParse({ ...adminRoute, path: "/api/admin/v1/users" }).success).toBe(false);
    expect(ExtensionApiRouteParamsSchema.safeParse({ pluginId: "../evil", routeId: "courses" }).success).toBe(false);
  });

  it("fails closed for public writes, unconstrained admin permissions and malformed shapes", () => {
    expect(ExtensionApiRouteSchema.safeParse({
      ...adminRoute, audience: "public", permission: undefined,
    }).success).toBe(false);
    expect(ExtensionApiRouteSchema.safeParse({
      ...adminRoute, permission: undefined,
    }).success).toBe(false);
    expect(ExtensionApiRouteSchema.safeParse({
      ...adminRoute, permission: "system.manage",
    }).success).toBe(false);
    expect(ExtensionApiRouteSchema.safeParse({
      ...adminRoute, body: { fields: { title: "string" }, required: ["unknown"] },
    }).success).toBe(false);
    expect(ExtensionApiRouteSchema.safeParse({
      ...adminRoute, method: "DELETE",
    }).success).toBe(false);
  });

  it("rejects undeclared keys, nested values, incorrect types and oversized values", () => {
    expect(validateExtensionApiObject(shape, { title: "Course", published: true }))
      .toEqual({ title: "Course", published: true });
    expect(validateExtensionApiObject(shape, { title: "Course", tenantId: "forged" })).toBeNull();
    expect(validateExtensionApiObject(shape, { published: true })).toBeNull();
    expect(validateExtensionApiObject(shape, { title: ["Course"] })).toBeNull();
    expect(validateExtensionApiObject(shape, { title: "x".repeat(4097) })).toBeNull();
    expect(validateExtensionApiObject({ fields: { count: "number" } }, { count: Number.POSITIVE_INFINITY }))
      .toBeNull();
    expect(validateExtensionApiObject(undefined, {})).toEqual({});
  });
});
