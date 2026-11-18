import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface BoundaryRule {
  readonly packageDir: string;
  readonly label: string;
  readonly allowedBareSpecifiers: readonly string[];
}

export function listTypeScriptFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    throw new Error(`Required source directory does not exist: ${directory}`);
  }
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

export function specifiers(content: string): string[] {
  return [...content.matchAll(IMPORT_PATTERN)].map((match) => match[1]!);
}

export function scan(
  files: readonly SourceFile[],
  rule: BoundaryRule,
): string[] {
  const violations: string[] = [];
  const normalizedPackageDir = path
    .resolve(ROOT, rule.packageDir)
    .split(path.sep)
    .join("/");

  for (const file of files) {
    const filePath = path.resolve(ROOT, file.path);
    const fileDir = path.dirname(filePath);

    for (const specifier of specifiers(file.content)) {
      if (specifier.startsWith("node:")) {
        continue;
      }

      if (specifier.startsWith(".")) {
        // Resolve relative import to ensure it does not escape the package root
        const resolved = path.resolve(fileDir, specifier).split(path.sep).join("/");
        if (!resolved.startsWith(normalizedPackageDir + "/") && resolved !== normalizedPackageDir) {
          violations.push(
            `${file.path} relative import escapes ${rule.packageDir}: ${specifier}`,
          );
        }
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

export function readSources(directory: string): SourceFile[] {
  const files = listTypeScriptFiles(directory);
  if (files.length === 0) {
    throw new Error(`No TypeScript source files found in: ${directory}`);
  }
  return files.map((file) => ({
    path: path.relative(ROOT, file).split(path.sep).join("/"),
    content: fs.readFileSync(file, "utf8"),
  }));
}

describe("platform dependency boundaries", () => {
  it("keeps the kernel free of publishing, database, config and web-framework imports", () => {
    const violations = scan(
      readSources(path.join(ROOT, "packages/platform-kernel/src")),
      {
        packageDir: "packages/platform-kernel",
        label: "kernel",
        allowedBareSpecifiers: [],
      },
    );
    expect(violations).toEqual([]);
  });

  it("keeps tenancy dependent only on the kernel", () => {
    const violations = scan(
      readSources(path.join(ROOT, "packages/tenancy/src")),
      {
        packageDir: "packages/tenancy",
        label: "tenancy",
        allowedBareSpecifiers: ["@vibress/platform-kernel"],
      },
    );
    expect(violations).toEqual([]);
  });

  it("keeps operator provisioning authority out of the request-serving sources", () => {
    const servingSources = [
      "apps/platform-reference/src/server.ts",
      "apps/platform-reference/src/start.ts",
    ];
    for (const file of servingSources) {
      const content = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(specifiers(content)).not.toContain("./registration");
      expect(content).not.toMatch(
        /PostgresApplicationRegistryStore|provisionReferenceApplication|ApplicationProvisioningOptions|ownerPool/,
      );
    }
  });

  it("detects a deliberately forbidden bare import", () => {
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

  it("detects a relative cross-package import attempting to escape package boundaries", () => {
    const violations = scan(
      [
        {
          path: "packages/platform-kernel/src/sub/leak.ts",
          content: 'import { getDb } from "../../../database/src/index";',
        },
      ],
      {
        packageDir: "packages/platform-kernel",
        label: "kernel",
        allowedBareSpecifiers: [],
      },
    );
    expect(violations).toEqual([
      "packages/platform-kernel/src/sub/leak.ts relative import escapes packages/platform-kernel: ../../../database/src/index",
    ]);
  });

  it("fails loudly if a required source directory is missing", () => {
    expect(() =>
      listTypeScriptFiles(path.join(ROOT, "packages/non-existent-package/src")),
    ).toThrow(/Required source directory does not exist/);
  });
});

describe("M03-S03 experimental execution architecture", () => {
  it("keeps operator and session supervisor out of public database exports and serving source imports", () => {
    const forbidden=/platform-schema-migration-operator|schema-operator-experimental-(?:supervisor|session|recovery-epoch|durable-authority|anchor)/;
    const index=fs.readFileSync(path.join(ROOT,"packages/database/src/index.ts"),"utf8");
    expect(index).not.toMatch(forbidden);
    const cli=fs.readFileSync(path.join(ROOT,"packages/database/src/schema-operator-cli.ts"),"utf8");
    expect(cli).toContain("DisposableDurableRecoveryAuthority.open");
    expect(cli).not.toContain("superviseDisposableSchemaOperation");
    for(const directory of ["apps","packages"]) {
      const sources=fs.readdirSync(path.join(ROOT,directory),{withFileTypes:true})
        .filter(entry=>entry.isDirectory() && fs.existsSync(path.join(ROOT,directory,entry.name,"src")))
        .flatMap(entry=>listTypeScriptFiles(path.join(ROOT,directory,entry.name,"src")))
        .map(file=>({path:path.relative(ROOT,file).split(path.sep).join("/"),content:fs.readFileSync(file,"utf8")}));
      for(const file of sources) {
        if(file.path.startsWith("packages/database/src/") && /\/(?:platform-schema-migration-operator|schema-operator-cli|schema-operator-experimental-[\w-]+)\.ts$/.test(file.path)) continue;
        expect(specifiers(file.content).filter(s=>forbidden.test(s)),file.path).toEqual([]);
      }
    }
  });
});
