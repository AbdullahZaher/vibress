// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const servingRoots = ["apps/api/src", "apps/platform-reference/src"];

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "node_modules") return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(full);
    if (!/\.tsx?$/.test(entry.name) || /(?:\.test|\.spec)\.[jt]sx?$/.test(entry.name))
      return [];
    return [full];
  });
}

describe("Fastify GHSA-3qgw-9275-xf8w mitigation", () => {
  it.each([
    "apps/api/src/main.ts",
    "apps/platform-reference/src/server.ts",
  ])("%s explicitly disables the vulnerable timeout path", (relative) => {
    const source = readFileSync(path.join(root, relative), "utf8");
    expect(source).toMatch(/Fastify\(\{[\s\S]*?handlerTimeout:\s*0\s*[,}]/);
  });

  it("refuses nonzero or dynamic handlerTimeout assignments in serving sources", () => {
    let checked = 0;
    for (const relative of servingRoots) {
      for (const file of sources(path.join(root, relative))) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/\bhandlerTimeout\s*:\s*([^,}\n]+)/g)) {
          const value = match[1]?.trim();
          expect(value, `unsafe handlerTimeout in ${path.relative(root, file)}`).toBe("0");
          checked++;
        }
      }
    }
    // Two Fastify serving constructors must remain explicitly guarded.
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});
