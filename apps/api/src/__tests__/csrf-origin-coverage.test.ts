import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.resolve(__dirname, "../routes");
const MUTATING = /^(post|put|patch|delete)$/i;
const ROUTE_PATTERN = /fastify\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;

type CookieMutation = {
  file: string;
  method: string;
  url: string;
  guard: "validateOrigin" | "validateMemberOrigin";
  block: string;
};

function collectCookieMutations(): CookieMutation[] {
  const mutations: CookieMutation[] = [];

  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");

    ROUTE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROUTE_PATTERN.exec(source)) !== null) {
      const method = (match[1] ?? "").toUpperCase();
      const url = match[2] ?? "";
      if (!MUTATING.test(method)) continue;

      const rest = source.slice(ROUTE_PATTERN.lastIndex);
      const next = rest.search(/fastify\.(get|post|put|patch|delete)\(\s*"/);
      const block = rest.slice(0, next === -1 ? rest.length : next);

      const guard = /requireMemberSession/.test(block)
        ? "validateMemberOrigin"
        : /requireStaffSession/.test(block)
          ? "validateOrigin"
          : null;
      if (!guard) continue;

      mutations.push({ file, method, url, guard, block });
    }
  }

  return mutations;
}

describe("Cookie-authenticated mutations enforce Origin validation", () => {
  const mutations = collectCookieMutations();

  it("finds the mutated route surface (scanner sanity check)", () => {
    expect(mutations.length).toBeGreaterThan(20);
    expect(mutations.some((route) => route.guard === "validateOrigin")).toBe(true);
    expect(mutations.some((route) => route.guard === "validateMemberOrigin")).toBe(
      true,
    );
  });

  it("requires the matching Origin guard on every cookie-authenticated mutation", () => {
    const missing = mutations
      .filter((route) => !route.block.includes(route.guard))
      .map((route) => `${route.file}: ${route.method} ${route.url}`);

    expect(missing).toEqual([]);
  });
});
