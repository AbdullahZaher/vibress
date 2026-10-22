import { describe, expect, it } from "vitest";
import { ExtensionAdminBridgeWriteRequestSchema } from "../plugins";

const message = (body: unknown) => ({
  type: "vibress:extension:write", version: 1,
  requestId: "one-request-01", body,
});

describe("EXT-301 Host-confirmed iframe write contract", () => {
  it("accepts bounded scalar body and fixed protocol", () => {
    expect(ExtensionAdminBridgeWriteRequestSchema.safeParse(
      message({ title: "دورة", published: false, price: 0 }),
    ).success).toBe(true);
  });

  it("rejects forged authority, nested structures and unknown transport fields", () => {
    for (const body of [
      { publicationId: "other" }, { workspaceId: "other" },
      { pluginId: "foreign" }, { memberId: "foreign-member" },
      { metadata: { publicationId: "other" } },
      { lessons: ["not", "scalar"] }, { title: "x".repeat(4097) },
      Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`field${i}`, i])),
    ]) {
      expect(ExtensionAdminBridgeWriteRequestSchema.safeParse(message(body)).success)
        .toBe(false);
    }
    expect(ExtensionAdminBridgeWriteRequestSchema.safeParse({
      ...message({ title: "A" }), url: "/api/admin/v1/users",
    }).success).toBe(false);
    expect(ExtensionAdminBridgeWriteRequestSchema.safeParse({
      ...message({ title: "A" }), method: "DELETE",
    }).success).toBe(false);
  });
});
