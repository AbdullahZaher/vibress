// @vitest-environment node
/**
 * M00-E03 — enforceable architecture boundary contract.
 * Static, offline, deterministic. No database or credentials required.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const FORBIDDEN_INFRASTRUCTURE = new Set([
  "@vibress/database",
  "@vibress/config",
  "@vibress/cache",
  "@vibress/queue",
  "@vibress/storage-s3",
]);
const CREDENTIAL_PATTERN = /POSTGRES_[A-Z_]*PASSWORD|DATABASE_URL|PGPASSWORD/;

function workspaceUnits() {
  const units = new Map();
  for (const base of ["apps", "packages", "packages/domains"]) {
    const dir = path.join(ROOT, base);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${base}/${entry.name}`;
      const file = path.join(ROOT, directory, "package.json");
      if (!fs.existsSync(file)) continue;
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pkg.name) units.set(pkg.name, { name: pkg.name, directory, pkg });
    }
  }
  return units;
}

function sourceFiles(unit) {
  const found = [];
  const base = path.join(ROOT, unit.directory, "src");
  if (!fs.existsSync(base)) return found;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", ".next", "__tests__"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(base);
  return found;
}

function specifiers(unit) {
  const result = [];
  for (const file of sourceFiles(unit)) {
    const body = fs.readFileSync(file, "utf8");
    let inTemplate = false;
    for (const line of body.split("\n")) {
      if (!inTemplate) {
        for (const match of line.matchAll(IMPORT_PATTERN)) {
          const before = [...line.slice(0, match.index).matchAll(/(?<!\\)`/g)].length;
          if (before % 2 === 0) {
            result.push({ file: path.relative(ROOT, file), specifier: match[1] });
          }
        }
      }
      const backticks = [...line.matchAll(/(?<!\\)`/g)].length;
      if (backticks % 2 === 1) inTemplate = !inTemplate;
    }
  }
  return result;
}

function workspaceDependencies(pkg, units) {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  return Object.keys(all).filter((name) => units.has(name) && name !== pkg.name);
}

const units = workspaceUnits();
const kernel = units.get("@vibress/platform-kernel");
const tenancy = units.get("@vibress/tenancy");

describe("M00-E03 architecture boundary contract", () => {
  it("keeps the kernel free of publication-specific domain imports", () => {
    const publicationPackages = [...units.keys()].filter((name) =>
      /^@vibress\/(posts|pages|publications|members|memberships|membership|subscriptions|billing|comments|tags|authors|revisions|media|storage-domain)$/.test(
        name,
      ),
    );
    expect(publicationPackages.length).toBeGreaterThan(0);
    expect(specifiers(kernel).map((entry) => entry.specifier).filter((name) => name.startsWith("@vibress/"))).toEqual([]);
    expect(workspaceDependencies(kernel.pkg, units)).toEqual([]);
  });

  it("keeps kernel, tenancy and plugin contract packages free of infrastructure adapters", () => {
    for (const name of ["@vibress/platform-kernel", "@vibress/tenancy", "@vibress/plugin-sdk", "@vibress/plugin-core"]) {
      const unit = units.get(name);
      expect(unit, `missing ${name}`).toBeDefined();
      for (const entry of specifiers(unit)) {
        expect(
          FORBIDDEN_INFRASTRUCTURE.has(entry.specifier),
          `${entry.file} imports infrastructure adapter ${entry.specifier}`,
        ).toBe(false);
      }
    }
  });

  it("never references migration-owner credentials from public contract sources", () => {
    for (const name of ["@vibress/platform-kernel", "@vibress/tenancy", "@vibress/plugin-sdk", "@vibress/plugin-core"]) {
      for (const file of sourceFiles(units.get(name))) {
        expect(CREDENTIAL_PATTERN.test(fs.readFileSync(file, "utf8")), file).toBe(false);
      }
    }
  });

  it("detects dependency cycles in the workspace graph", () => {
    const graph = new Map([...units.values()].map((unit) => [unit.name, workspaceDependencies(unit.pkg, units)]));
    const visiting = new Set();
    const visited = new Set();
    const cycles = [];
    const visit = (node, stack) => {
      if (visiting.has(node)) {
        cycles.push([...stack.slice(stack.indexOf(node)), node].join(" -> "));
        return;
      }
      if (visited.has(node)) return;
      visiting.add(node);
      for (const next of graph.get(node) ?? []) visit(next, [...stack, node]);
      visiting.delete(node);
      visited.add(node);
    };
    for (const node of graph.keys()) visit(node, []);
    expect(cycles).toEqual([]);
  });

  it("rejects cross-package private imports and relative escapes", () => {
    for (const unit of units.values()) {
      const declared = new Set(workspaceDependencies(unit.pkg, units));
      const unitRoot = path.join(ROOT, unit.directory);
      for (const entry of specifiers(unit)) {
        if (entry.specifier.startsWith("@vibress/")) {
          const packageName = entry.specifier.split("/").slice(0, 2).join("/");
          expect(
            declared.has(packageName),
            `${entry.file} imports undeclared ${entry.specifier}`,
          ).toBe(true);
        } else if (entry.specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(path.join(ROOT, entry.file)), entry.specifier);
          expect(
            resolved.startsWith(`${unitRoot}${path.sep}`),
            `${entry.file} escapes ${unit.directory}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the external CRM consumer on the public kernel contract only", () => {
    const file = path.join(ROOT, "examples/external-crm-consumer/src/app.ts");
    expect(fs.existsSync(file)).toBe(true);
    const body = fs.readFileSync(file, "utf8");
    const specs = [...body.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
    expect(specs).toEqual(["@vibress/platform-kernel"]);
    expect(body).not.toMatch(/\.\.\/\.\.\/packages/);
  });

  it("preserves the legal CMS compatibility surface without exposing it through the kernel", () => {
    const compatibilityFile = path.join(ROOT, "packages/database/src/schema/operations.ts");
    expect(fs.existsSync(compatibilityFile)).toBe(true);
    const body = fs.readFileSync(compatibilityFile, "utf8");
    expect(body).toMatch(/pub_default/);
    expect(
      specifiers(kernel).some((entry) => entry.specifier.includes("database")),
    ).toBe(false);
  });
});
