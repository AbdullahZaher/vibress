import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const forbiddenTracked = [
  "graph.json",
  "run_tests.sh",
  "setup-workspace.sh",
  "setup-domain-packages.sh",
  "setup-platform-packages.sh",
  "scripts/capture-settings-screenshots.ts",
  "scripts/media-storage-audit.json",
  "VIBRESS_THEME_DESIGNER_PACKAGE/vibress-theme-starter.zip",
];
const archivedReports = [
  "VIBRESS_CONTENT_MODELER_FINAL_CERTIFICATION_REPORT.md",
  "VIBRESS_CONTENT_MODELER_FINAL_CONSISTENCY_AUDIT.md",
  "VIBRESS_CONTENT_MODELER_IMPLEMENTATION_REPORT.md",
  "VIBRESS_CONTENT_MODELER_PRODUCTION_AUDIT.md",
  "VIBRESS_CONTENT_MODELER_RELATIONS_FINAL_CERTIFICATION.md",
  "VIBRESS_CONTENT_MODELER_RELATION_CONTRACT_FINAL_AUDIT.md",
  "VIBRESS_FEATURE_IMAGE_UNSPLASH_IMPLEMENTATION_REPORT.md",
  "VIBRESS_FINAL_GIT_RELEASE_REPORT.md",
  "VIBRESS_MEDIA_LIBRARY_BROKEN_ASSETS_FORENSIC_ANALYSIS.md",
  "VIBRESS_MEDIA_STORAGE_REMEDIATION_FINAL_REPORT.md",
  "VIBRESS_STUDIO_MEDIA_FLOATING_TOOLBAR_IMPLEMENTATION.md",
  "VIBRESS_V1.0.0_RELEASE_REPORT.md"
];

function trackedFiles(): Set<string> {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  return new Set(output.split("\0").filter(Boolean));
}

describe("repository hygiene compatibility", () => {
  it("does not track generated, obsolete, or environment-specific artifacts", () => {
    const tracked = trackedFiles();
    for (const entry of forbiddenTracked) {
      expect(tracked.has(entry), entry).toBe(false);
    }
  });

  it("preserves each historical report under the dated archive", () => {
    const tracked = trackedFiles();
    for (const filename of archivedReports) {
      expect(tracked.has(filename), filename).toBe(false);
      expect(tracked.has(`docs/archive/2026-09/${filename}`), filename).toBe(true);
    }
  });

  it("keeps committed admin redesign screenshots unique and valid PNGs", () => {
    const directory = path.join(root, "docs/design/screenshots/redesign");
    const filenames = readdirSync(directory).filter((name) => name.endsWith(".png")).sort();
    const firstPathByHash = new Map<string, string>();
    expect(filenames.length).toBeGreaterThan(0);

    for (const filename of filenames) {
      const bytes = readFileSync(path.join(directory, filename));
      expect(
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `${filename} must be a PNG`,
      ).toBe(true);
      const hash = createHash("sha256").update(bytes).digest("hex");
      expect(
        firstPathByHash.has(hash),
        `Duplicate screenshot: ${filename} and ${firstPathByHash.get(hash)}`,
      ).toBe(false);
      firstPathByHash.set(hash, filename);
    }
  });

  it("retains stable public paths and canonical theme distribution", () => {
    const tracked = trackedFiles();
    for (const path of [
      "content/vibress-theme-starter.zip",
      "content/theme-starter/theme.json",
      "VIBRESS_THEME_DESIGNER_PACKAGE.zip",
      "apps/web/public/student.html",
      "apps/web/public/theme-assets/student.html",
    ]) {
      expect(tracked.has(path), path).toBe(true);
    }
    // Different URLs remain valid public contracts; identical bytes are intentional.
    const stableCopies = [
      ["apps/web/public/student.html", "apps/web/public/theme-assets/student.html"],
      ["apps/web/src/themes/default/casper.css", "apps/web/public/theme-assets/vibress-default/1.0.0/default.css"],
      ["apps/web/src/themes/minimal/source.css", "apps/web/public/theme-assets/vibress-minimal/1.0.0/source.css"],
      ["apps/web/src/themes/molten/screen.css", "apps/web/public/theme-assets/vibress-molten/1.0.0/screen.css"],
      ["apps/web/src/themes/shared/studio-cards.css", "apps/web/public/theme-assets/shared/studio-cards.css"],
    ] as const;
    for (const [source, publicCopy] of stableCopies) {
      const canonical = readFileSync(path.join(root, source));
      const published = readFileSync(path.join(root, publicCopy));
      expect(published.equals(canonical), `${publicCopy} diverged from ${source}`).toBe(true);
    }

    const a = readFileSync(path.join(root, "apps/web/public/student.html"));
    const b = readFileSync(path.join(root, "apps/web/public/theme-assets/student.html"));
    expect(a.equals(b)).toBe(true);
  });

  it("builds the designer ZIP with the canonical starter and without writing tracked artifacts", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "vibress-theme-package-test-"));
    try {
      const output = path.join(directory, "designer.zip");
      execFileSync(process.execPath, ["scripts/pack-theme-designer-package.js"], {
        cwd: root,
        env: { ...process.env, VIBRESS_THEME_DESIGNER_PACKAGE_OUTPUT: output },
        timeout: 30000,
      });
      const buffer = readFileSync(output);
      expect(buffer.subarray(0, 2).toString()).toBe("PK");
      expect(buffer.includes(Buffer.from("vibress-theme-starter.zip"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
