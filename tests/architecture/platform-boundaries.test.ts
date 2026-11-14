import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

interface SourceFile {
  readonly path: string;
  readonly content: string;
}

interface BoundaryRule {
  readonly packageDir: string;
  readonly label: string;
  readonly allowedBareSpecifiers: readonly string[];
}

function listTypeScriptFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...listTypeScriptFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function specifiers(content: string): string[] {
  return [...content.matchAll(IMPORT_PATTERN)].map((match) => match[1]!);
}

function scan(
  files: readonly SourceFile[],
  rule: BoundaryRule,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const specifier of specifiers(file.content)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) {
        continue;
      }
      if (rule.allowedBareSpecifiers.includes(specifier)) {
        continue;
      }
      violations.push(`${file.path} imports ${specifier}`);
    }
  }
  return violations;
}

function readSources(directory: string): SourceFile[] {
  return listTypeScriptFiles(directory).map((file) => ({
    path: path.relative(ROOT, file).split(path.sep).join("/"),
    content: fs.readFileSync(file, "utf8"),
  }));
}

describe("platform dependency boundaries", () => {
  it("keeps the kernel free of publishing, database, config and web-framework imports", () => {
    const violations = scan(readSources(path.join(ROOT, "packages/platform-kernel/src")), {
      packageDir: "packages/platform-kernel",
      label: "kernel",
      allowedBareSpecifiers: [],
    });
    expect(violations).toEqual([]);
  });

  it("keeps tenancy dependent only on the kernel", () => {
    const violations = scan(readSources(path.join(ROOT, "packages/tenancy/src")), {
      packageDir: "packages/tenancy",
      label: "tenancy",
      allowedBareSpecifiers: ["@vibress/platform-kernel"],
    });
    expect(violations).toEqual([]);
  });

  it("detects a deliberately forbidden import", () => {
    const violations = scan(
      [
        {
          path: "synthetic/kernel.ts",
          content: 'import { posts } from "@vibress/posts";',
        },
      ],
      {
        packageDir: "synthetic",
        label: "kernel",
        allowedBareSpecifiers: [],
      },
    );
    expect(violations).toEqual([
      "synthetic/kernel.ts imports @vibress/posts",
    ]);
  });
});
