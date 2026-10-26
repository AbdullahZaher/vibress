import { describe, it, expect } from "vitest";
import { sanitizeReturnTo } from "../../apps/portal/src/lib/return-to";

describe("Portal Return-To Security & Open Redirect Prevention", () => {
  const BASE_ORIGIN = "http://localhost:7777";

  it("permits safe relative application paths", () => {
    const safePaths = [
      "/",
      "/articles/first-post",
      "/about",
      "/tag/technology?sort=recent",
      "/author/john-doe#bio",
      "/portal-announcement", // legitimate blog post with 'portal' in slug
      "/administration-guide", // legitimate blog post with 'admin' in slug
    ];

    for (const path of safePaths) {
      const sanitized = sanitizeReturnTo(path, BASE_ORIGIN);
      expect(sanitized).toBe(path);
    }
  });

  it("strictly rejects protocol-relative, backslash, and external open-redirect payloads", () => {
    const maliciousPayloads = [
      "//evil.com",
      "//evil.com/path",
      "///evil.com",
      "////evil.com",
      "/\\evil.com",
      "/\\\\evil.com",
      "/\\/evil.com",
      "/foo\\evil.com",
      "https://attacker.example.com",
      "http://attacker.example.com",
      "//localhost:7777@attacker.com",
      "https://localhost:7777.evil.com",
      "javascript:alert(document.domain)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "blob:http://localhost:7777/uuid",
      "/\t/evil.com",
      "/ \t/evil.com",
      "/\r\n/evil.com",
      "/path\0with-null",
      "   //evil.com   ",
    ];

    for (const payload of maliciousPayloads) {
      const sanitized = sanitizeReturnTo(payload, BASE_ORIGIN);
      expect(sanitized).toBeNull();
    }
  });

  it("rejects loop redirection into authenticated portal or admin panels", () => {
    const loopPaths = [
      "/portal",
      "/portal/",
      "/portal/#/account",
      "/portal/#/plans",
      "/portal/settings",
      "/admin",
      "/admin/",
      "/admin/members",
      "/admin/settings",
      "/PORTAL",
      "/ADMIN",
    ];

    for (const path of loopPaths) {
      const sanitized = sanitizeReturnTo(path, BASE_ORIGIN);
      expect(sanitized).toBeNull();
    }
  });

  it("safely handles non-string, null, or malformed inputs without throwing", () => {
    const invalidInputs = [
      null,
      undefined,
      "",
      "   ",
      12345,
      {},
      [],
      true,
    ];

    for (const input of invalidInputs) {
      expect(sanitizeReturnTo(input, BASE_ORIGIN)).toBeNull();
    }
  });
});
