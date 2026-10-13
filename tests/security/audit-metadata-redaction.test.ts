import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "@vibress/audit";

describe("audit metadata sanitization", () => {
  it("redacts sensitive keys inside nested arrays", () => {
    const sanitized = sanitizeAuditMetadata({
      request: {
        headers: [
          {
            authorization: "Bearer secret-token",
            "x-request-id": "req_123",
          },
          {
            nested: [
              {
                cookie: "session=secret",
                safe: "kept",
              },
            ],
          },
        ],
      },
      events: [
        {
          payload: {
            password: "p@ssw0rd",
            publicValue: "visible",
          },
        },
      ],
    });

    expect(sanitized).toEqual({
      request: {
        headers: [
          {
            authorization: "[REDACTED]",
            "x-request-id": "req_123",
          },
          {
            nested: [
              {
                cookie: "[REDACTED]",
                safe: "kept",
              },
            ],
          },
        ],
      },
      events: [
        {
          payload: {
            password: "[REDACTED]",
            publicValue: "visible",
          },
        },
      ],
    });
  });

  it("preserves non-sensitive primitive array values", () => {
    const sanitized = sanitizeAuditMetadata({
      ids: ["post_1", "post_2"],
      attempts: [1, 2, 3],
      flags: [true, false],
    });

    expect(sanitized).toEqual({
      ids: ["post_1", "post_2"],
      attempts: [1, 2, 3],
      flags: [true, false],
    });
  });

  it("redacts excessively deep metadata instead of recursing indefinitely", () => {
    let nested: Record<string, unknown> = { safe: "leaf" };
    for (let i = 0; i < 25; i += 1) {
      nested = { child: nested };
    }

    const sanitized = sanitizeAuditMetadata({ nested });
    let current: unknown = sanitized?.nested;

    for (let i = 0; i < 20; i += 1) {
      expect(typeof current).toBe("object");
      expect(current).not.toBeNull();
      expect(Array.isArray(current)).toBe(false);
      current = (current as Record<string, unknown>).child;
    }

    expect(current).toBe("[REDACTED]");
  });
});
