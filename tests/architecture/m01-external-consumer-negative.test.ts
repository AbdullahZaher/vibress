// @vitest-environment node
/**
 * M01 isolated continuation — deterministic external-consumer negative fixtures.
 * No runtime, database, hosting or M04 Batch 03 capability is activated.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, "examples/external-crm-consumer/src/app.ts");
const IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const ALLOWED = new Set(["@vibress/platform-kernel"]);

function forbiddenSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)]
    .map((match) => match[1]!)
    .filter((specifier) => !ALLOWED.has(specifier) && !specifier.startsWith("node:"));
}

describe("M01 external consumer boundary matrix", () => {
  it("accepts the canonical fixture with one public kernel import", () => {
    const source = fs.readFileSync(FIXTURE, "utf8");
    expect(forbiddenSpecifiers(source)).toEqual([]);
    expect(source).toMatch(/defineApplication\(/);
    expect(source).toMatch(/defineAction\(/);
    expect(source).toMatch(/path:\s*"\/crm\/deals\/:dealId\/approve"/);
  });

  it.each([
    ["private workspace path", 'import { defineApplication } from "../../../packages/platform-kernel/src";'],
    ["private database adapter", 'import { getDb } from "@vibress/database";'],
    ["private config adapter", 'import { config } from "@vibress/config";'],
    ["direct Fastify server", 'import Fastify from "fastify";'],
    ["relative sibling import", 'import { secret } from "./internal-runtime";'],
  ])("refuses %s", (_label, source) => {
    expect(forbiddenSpecifiers(source).length).toBeGreaterThan(0);
  });

  it("records the lifecycle matrix as a checked inventory", () => {
    const matrix = fs.readFileSync(
      path.join(ROOT, "docs/platform-roadmap/execution/universal-platform-2026-11-21/M01-EXTERNAL-APPLICATION-LIFECYCLE-TEST-MATRIX.md"),
      "utf8",
    );
    expect(matrix).toMatch(/NOT EVIDENCED/);
    expect(matrix).not.toMatch(/production hosting enabled/i);
  });
});
