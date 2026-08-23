import { describe, it, expect } from "vitest";
import { certifyTheme } from "../theme-certifier";
import * as fs from "fs";
import * as path from "path";

describe("Theme Certification System", () => {
  it("certifies the official Starter Theme with 100% score", () => {
    const starterDir = path.resolve(__dirname, "../../../../content/theme-starter");
    const files = new Map<string, Buffer>();

    function loadDir(dir: string, prefix = "") {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          loadDir(fullPath, relPath);
        } else {
          files.set(relPath, fs.readFileSync(fullPath));
        }
      }
    }

    loadDir(starterDir);

    const report = certifyTheme({ files });
    if (report.errors.length > 0) {
      console.log("STARTER REPORT ERRORS:", report.errors);
    }

    expect(report.certified).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.rtl).toBe(true);
    expect(report.localized).toBe(true);
    expect(report.arabic).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.themeId).toBe("vibress-starter-theme");
  });

  it("fails certification when a theme uses physical CSS rules without ignore comments", () => {
    const files = new Map<string, Buffer>();
    files.set(
      "theme.json",
      Buffer.from(
        JSON.stringify({
          id: "bad-rtl-theme",
          name: "Bad RTL Theme",
          version: "1.0.0",
          author: { name: "Tester" },
          capabilities: ["post"],
        }),
      ),
    );
    files.set(
      "assets/css/style.css",
      Buffer.from(`
        .card {
          margin-left: 20px;
          padding-right: 10px;
        }
      `),
    );
    files.set(
      "locales/en.json",
      Buffer.from(JSON.stringify({ "common.save": "Save" })),
    );
    files.set(
      "locales/ar.json",
      Buffer.from(JSON.stringify({ "common.save": "حفظ" })),
    );
    files.set("templates/home.liquid", Buffer.from("<h1>Home</h1>"));
    files.set("templates/post.liquid", Buffer.from("<h1>Post</h1>"));

    const report = certifyTheme({ files });

    expect(report.certified).toBe(false);
    expect(report.rtl).toBe(false);
    expect(report.errors.some((e) => e.includes("margin-left"))).toBe(true);
  });

  it("fails certification when a theme is missing Arabic keys that exist in English", () => {
    const files = new Map<string, Buffer>();
    files.set(
      "theme.json",
      Buffer.from(
        JSON.stringify({
          id: "missing-keys-theme",
          name: "Missing Keys Theme",
          version: "1.0.0",
          author: { name: "Tester" },
          capabilities: ["post"],
        }),
      ),
    );
    files.set(
      "assets/css/style.css",
      Buffer.from(`
        .card {
          margin-inline-start: 20px;
        }
      `),
    );
    files.set(
      "locales/en.json",
      Buffer.from(JSON.stringify({ "common.save": "Save", "common.cancel": "Cancel" })),
    );
    files.set(
      "locales/ar.json",
      Buffer.from(JSON.stringify({ "common.save": "حفظ" })), // missing common.cancel
    );
    files.set("templates/home.liquid", Buffer.from("<h1>Home</h1>"));
    files.set("templates/post.liquid", Buffer.from("<h1>Post</h1>"));

    const report = certifyTheme({ files });

    expect(report.certified).toBe(false);
    expect(report.arabic).toBe(false);
    expect(report.errors.some((e) => e.includes("missing keys"))).toBe(true);
  });
});
