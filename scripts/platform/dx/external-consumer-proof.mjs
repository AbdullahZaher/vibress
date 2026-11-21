#!/usr/bin/env node
/**
 * M01-E09 — clean external consumer proof using a packed kernel contract.
 *
 * Offline and nonproduction: npm pack -> extract into a disposable consumer ->
 * typecheck a fixture that imports only the public kernel entry. It never
 * starts a server, touches a database or enables application hosting.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const CONSUMER_FIXTURE = "examples/external-crm-consumer/src/app.ts";
export const KERNEL_PACKAGE_DIR = "packages/platform-kernel";

const IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

export function inspectConsumerSource(repoRoot) {
  const source = fs.readFileSync(path.join(repoRoot, CONSUMER_FIXTURE), "utf8");
  const specifiers = [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
  const forbidden = specifiers.filter(
    (specifier) => specifier !== "@vibress/platform-kernel" && !specifier.startsWith("node:"),
  );
  return {
    specifiers: [...new Set(specifiers)].sort(),
    forbiddenImports: [...new Set(forbidden)].sort(),
    customActions: [...source.matchAll(/name:\s*"([a-zA-Z][a-zA-Z0-9_]*)"/g)].map((match) => match[1]),
    routes: [...source.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]),
  };
}

export function publicationStatus(repoRoot) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, KERNEL_PACKAGE_DIR, "package.json"), "utf8"),
  );
  const privatePackage = pkg.private === true;
  const typescriptEntry = pkg.main === "src/index.ts" || pkg.types === "src/index.ts";
  return {
    privatePackage,
    typescriptSourceEntry: typescriptEntry,
    publishable: !privatePackage && !typescriptEntry,
    reason: privatePackage
      ? "package is private; public registry publication is not authorized (A2/G6)"
      : typescriptEntry
        ? "entry is TypeScript source; a built publishable artifact is required"
        : null,
  };
}

export function validateProof(proof) {
  const errors = [];
  if (proof.consumer.forbiddenImports.length > 0) {
    errors.push(`forbidden imports: ${proof.consumer.forbiddenImports.join(", ")}`);
  }
  if (!proof.consumer.specifiers.includes("@vibress/platform-kernel")) {
    errors.push("consumer does not import the public kernel entry");
  }
  if (proof.consumer.customActions.length === 0) errors.push("no custom action declared");
  if (proof.consumer.routes.length === 0) errors.push("no custom route declared");
  if (!proof.pack.entryPresent) errors.push("packed artifact does not contain src/index.ts");
  if (proof.typecheck.exitCode !== 0) errors.push("external consumer typecheck failed");
  if (proof.runtime.hostingEnabled) {
    errors.push("unsupported production application hosting must remain disabled");
  }
  return errors;
}

/** Execute the offline proof. Returns a JSON-serializable evidence object. */
export function runExternalConsumerProof(repoRoot, options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-consumer-"));
  const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  try {
    const consumer = inspectConsumerSource(repoRoot);
    const publication = publicationStatus(repoRoot);

    const packOutput = execFileSync(
      "npm",
      ["pack", "--pack-destination", temporaryRoot, "--json"],
      {
        cwd: path.join(repoRoot, KERNEL_PACKAGE_DIR),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const parsedPack = JSON.parse(packOutput);
    const packRecord = Array.isArray(parsedPack) ? parsedPack[0] : Object.values(parsedPack)[0];
    const tarballName = packRecord?.filename;
    if (!tarballName) throw new Error("npm pack did not report a tarball");
    const tarball = path.join(temporaryRoot, tarballName);
    const unpackRoot = path.join(temporaryRoot, "unpack");
    fs.mkdirSync(unpackRoot, { recursive: true });
    execFileSync("tar", ["-xzf", tarball, "-C", unpackRoot], { stdio: "ignore" });

    const installedDir = path.join(temporaryRoot, "consumer", "node_modules", "@vibress", "platform-kernel");
    fs.mkdirSync(path.dirname(installedDir), { recursive: true });
    fs.cpSync(path.join(unpackRoot, "package"), installedDir, { recursive: true });

    const consumerDir = path.join(temporaryRoot, "consumer");
    fs.mkdirSync(path.join(consumerDir, "src"), { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, CONSUMER_FIXTURE),
      path.join(consumerDir, "src", "app.ts"),
    );
    fs.writeFileSync(
      path.join(consumerDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            skipLibCheck: true,
            typeRoots: [path.join(repoRoot, "node_modules", "@types")],
            types: ["node"],
            baseUrl: ".",
            paths: {
              "@vibress/platform-kernel": [
                "./node_modules/@vibress/platform-kernel/src/index.ts",
              ],
            },
          },
          include: ["src/app.ts"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    let typecheck = { exitCode: 0, output: "typecheck passed" };
    try {
      execFileSync(process.execPath, [tscBin, "-p", path.join(consumerDir, "tsconfig.json")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      typecheck = { exitCode: Number(error.status ?? 1), output: String(error.stdout ?? error.message) };
    }

    const proof = {
      schemaVersion: 1,
      consumer,
      publication,
      pack: {
        filename: tarballName,
        sha256: createHash("sha256").update(fs.readFileSync(tarball)).digest("hex"),
        entryPresent: fs.existsSync(path.join(installedDir, "src", "index.ts")),
      },
      typecheck,
      runtime: { hostingEnabled: false, serverStarted: false, databaseTouched: false },
    };
    proof.errors = validateProof(proof);
    return proof;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
