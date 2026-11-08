import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveContainedThemeAsset } from "../theme-asset-files";
import { isAllowedBuiltInThemeScript, isPublicExternalThemeAssetPath } from "../theme-asset-scope";

const temporaryRoots: string[] = [];
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-theme-security-"));
  temporaryRoots.push(root);
  return root;
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("theme asset public file boundary", () => {
  it("accepts presentation assets and rejects source and executable file suffixes", () => {
    for (const name of ["style.css", "icons/mark.svg", "cover.webp", "font.woff2"]) {
      expect(isPublicExternalThemeAssetPath(name)).toBe(true);
    }
    for (const name of ["README.md", "theme.ts", "theme.json", "components/Post.tsx", "main.min.js", "templates/page.liquid"]) {
      expect(isPublicExternalThemeAssetPath(name)).toBe(false);
    }
    expect(isAllowedBuiltInThemeScript("vibress-molten", "1.0.0", "main.min.js")).toBe(true);
    const forbiddenScripts: Array<[string, string, string]> = [
      ["attacker", "1.0.0", "main.min.js"],
      ["vibress-molten", "2.0.0", "main.min.js"],
      ["vibress-molten", "1.0.0", "other.js"],
      ["vibress-molten", "1.0.0", "../main.min.js"],
    ];
    for (const [id, version, file] of forbiddenScripts) {
      expect(isAllowedBuiltInThemeScript(id, version, file)).toBe(false);
    }
  });

  it("resolves an ordinary nested asset within the installed theme root", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "assets"));
    const file = path.join(root, "assets", "style.css");
    fs.writeFileSync(file, "body { color: red; }");
    expect(resolveContainedThemeAsset(root, file)).toBe(fs.realpathSync(file));
  });

  it("rejects traversal and files outside the root, including symlink escapes", () => {
    const base = makeRoot();
    const allowedRoot = path.join(base, "theme");
    fs.mkdirSync(allowedRoot);
    const outside = path.join(base, "secret.css");
    fs.writeFileSync(outside, "private");
    expect(resolveContainedThemeAsset(allowedRoot, outside)).toBeNull();
    const link = path.join(allowedRoot, "fake.css");
    fs.symlinkSync(outside, link);
    expect(resolveContainedThemeAsset(allowedRoot, link)).toBeNull();
    expect(resolveContainedThemeAsset(allowedRoot, path.join(allowedRoot, "..", "secret.css"))).toBeNull();
  });

  it("allows an internal symlink that stays within the trusted root", () => {
    const root = makeRoot();
    const asset = path.join(root, "safe.css");
    fs.writeFileSync(asset, "safe");
    const alias = path.join(root, "alias.css");
    fs.symlinkSync(asset, alias);
    expect(resolveContainedThemeAsset(root, alias)).toBe(fs.realpathSync(asset));
  });
});
