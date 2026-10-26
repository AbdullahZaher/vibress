import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginModule } from "@vibress/plugin-sdk";
import {
  ExtensionNativeAdminPageV1Schema,
  ExtensionNativeDomainWorkflowV1Schema,
} from "@vibress/api-contracts";
import { admitNativeAdminPage } from "../../apps/api/src/plugins/native-admin-registry";
import { admitNativeDataRegistry } from "../../apps/api/src/plugins/native-data-registry";
import { admitNativeDomainWorkflow } from "../../apps/api/src/plugins/native-domain-workflow";

const label = { en: "Independent Records", ar: "السجلات المستقلة" };

/**
 * NUI-07 Genuine Packaged SDK Consumer Acceptance:
 *
 * Validates that an external plugin consumer outside the Vibress monorepo:
 * 1. Installs a genuinely prepared `.tgz` package artifact produced by `pnpm pack`.
 * 2. Compiles a standalone TypeScript plugin against the installed package using strict `tsc`.
 * 3. Resolves standard runtime exports (`SDK_VERSION`, `validateManifest`) without monorepo shortcuts.
 * 4. Fails compilation when attempting to import private Host internal packages (@vibress/database, @vibress/domains).
 * 5. Passes all Host admission checks for conforming native descriptors.
 * 6. Fails closed when presented with invalid contracts, unknown component types, or unbound workflows.
 */
const repoRoot = path.resolve(__dirname, "../..");
const sdkDir = path.resolve(repoRoot, "packages/plugin-sdk");

let tmpConsumerDir: string | null = null;
let tarballPath: string | null = null;
let sdkRuntime: { SDK_VERSION: string; validateManifest?: unknown } | null = null;

const packagedExternalPlugin: PluginModule = {
  activate() {},
  routes: [
    {
      id: "catalog",
      audience: "admin",
      method: "GET",
      permission: "plugins.manage",
      response: { fields: { count: "number" }, required: ["count"] },
      handle: () => ({ count: 5 }),
    },
    {
      id: "catalog",
      audience: "admin",
      method: "POST",
      permission: "plugins.manage",
      body: {
        fields: {
          recordId: "string",
          expectedVersion: "number",
          operation: "string",
          title_en: "string",
        },
        required: ["recordId", "expectedVersion", "operation", "title_en"],
      },
      response: {
        fields: {
          recordId: "string",
          version: "number",
          outcome: "string",
          status: "string",
        },
        required: ["recordId", "version", "outcome", "status"],
      },
      handle: () => ({
        recordId: "item-1",
        version: 1,
        outcome: "created",
        status: "draft",
      }),
    },
  ],
  adminViews: [{ id: "catalog-view", routeId: "catalog", title: label }],
  adminNavigation: [{ viewId: "catalog-view", label, permission: "plugins.manage" }],
  adminPages: [
    {
      schemaVersion: 1,
      viewId: "catalog-view",
      title: label,
      components: [
        { type: "stat", id: "count", label, field: "count" },
      ],
    },
  ],
  adminResources: [
    {
      id: "catalog-items",
      viewId: "catalog-view",
      modelKey: "catalog_items",
      fields: ["title_en", "status"],
      textFilters: ["status"],
    },
  ],
  adminDomainWorkflows: [
    {
      schemaVersion: 1,
      viewId: "catalog-view",
      routeId: "catalog",
      resourceId: "catalog-items",
      idField: "recordId",
      versionField: "expectedVersion",
      operationField: "operation",
      operations: ["create", "save", "publish"],
      fields: [{ key: "title_en", label, maxLength: 120 }],
    },
  ],
};

describe("NUI-07 Genuine Packaged SDK Consumer and Contract Conformance", () => {
  beforeAll(async () => {
    // 1. Build SDK deterministically into dist
    execFileSync("pnpm", ["--filter", "@vibress/plugin-sdk", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    // 2. Prepare an isolated consumer directory outside the monorepo
    tmpConsumerDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-packaged-consumer-"));

    // 3. Produce a canonical .tgz package artifact using pnpm pack
    execFileSync("pnpm", ["--filter", "@vibress/plugin-sdk", "pack", "--pack-destination", tmpConsumerDir], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const tarballFiles = fs.readdirSync(tmpConsumerDir).filter((file) => file.endsWith(".tgz"));
    expect(tarballFiles.length).toBeGreaterThan(0);
    tarballPath = path.join(tmpConsumerDir, tarballFiles[0]!);

    // 4. Initialize external consumer project with its own package.json
    fs.writeFileSync(
      path.join(tmpConsumerDir, "package.json"),
      JSON.stringify(
        {
          name: "external-consumer-plugin",
          version: "1.0.0",
          private: true,
          type: "module",
        },
        null,
        2,
      ),
    );

    // 5. Install the locally prepared .tgz package artifact
    execFileSync("npm", ["install", "--no-package-lock", tarballPath], {
      cwd: tmpConsumerDir,
      stdio: "pipe",
    });

    // 6. Verify Node.js runtime resolution in the external consumer project
    const runtimeScript = path.join(tmpConsumerDir, "check-runtime.mjs");
    fs.writeFileSync(
      runtimeScript,
      `
import { SDK_VERSION, validateManifest } from "@vibress/plugin-sdk";
if (SDK_VERSION !== "1.0.0" || typeof validateManifest !== "function") {
  process.exit(1);
}
console.log(JSON.stringify({ SDK_VERSION, hasValidateManifest: true }));
`,
    );

    const runtimeOutput = execFileSync(process.execPath, [runtimeScript], {
      cwd: tmpConsumerDir,
      encoding: "utf-8",
    });
    sdkRuntime = JSON.parse(runtimeOutput);
  }, 60000);

  afterAll(() => {
    // 7. Clean temporary consumer directories and artifacts
    if (tmpConsumerDir && fs.existsSync(tmpConsumerDir)) {
      fs.rmSync(tmpConsumerDir, { recursive: true, force: true });
    }
  });

  it("exports stable SDK_VERSION = '1.0.0' from the installed package artifact", () => {
    expect(sdkRuntime?.SDK_VERSION).toBe("1.0.0");
  });

  it("contains complete TypeScript declaration files in installed package without Host internals", () => {
    expect(tmpConsumerDir).toBeTruthy();
    const installedDts = path.join(tmpConsumerDir!, "node_modules/@vibress/plugin-sdk/dist/index.d.ts");
    expect(fs.existsSync(installedDts)).toBe(true);

    const dts = fs.readFileSync(installedDts, "utf-8");

    // Public API symbols must be declared
    expect(dts).toContain("SDK_VERSION");
    expect(dts).toContain("PluginModule");
    expect(dts).toContain("PluginAdminDataResourceV1");
    expect(dts).toContain("PluginAdminDomainWorkflowV1");
    expect(dts).toContain("PluginNativeAdminPageV1");

    // Host private internals must NOT leak into the public SDK declaration
    expect(dts).not.toContain("@vibress/database");
    expect(dts).not.toContain("@vibress/domains");
    expect(dts).not.toContain("fastify");
    expect(dts).not.toContain("drizzle-orm");
  });

  it("compiles a standalone external plugin against the installed package using strict tsc", () => {
    expect(tmpConsumerDir).toBeTruthy();
    const consumerDir = tmpConsumerDir!;

    // Create standalone consumer tsconfig.json
    fs.writeFileSync(
      path.join(consumerDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            skipLibCheck: false,
            noEmit: true,
          },
          include: ["standalone-plugin.ts"],
        },
        null,
        2,
      ),
    );

    // Create standalone external plugin using ONLY public exports of @vibress/plugin-sdk
    fs.writeFileSync(
      path.join(consumerDir, "standalone-plugin.ts"),
      `
import {
  SDK_VERSION,
  type PluginModule,
  type PluginNativeAdminPageV1,
  type PluginAdminDataResourceV1,
  type PluginAdminDomainWorkflowV1,
} from "@vibress/plugin-sdk";

const title = { en: "Standalone Course Catalog", ar: "كتالوج الدورات المستقل" };

export const plugin: PluginModule = {
  activate() {},
  routes: [{
    id: "catalog",
    audience: "admin",
    method: "GET",
    permission: "plugins.manage",
    response: { fields: { version: "string" }, required: ["version"] },
    handle: () => ({ version: SDK_VERSION }),
  }],
  adminViews: [{ id: "catalog-view", routeId: "catalog", title }],
  adminNavigation: [{ viewId: "catalog-view", label: title, permission: "plugins.manage" }],
  adminPages: [{
    schemaVersion: 1,
    viewId: "catalog-view",
    title,
    components: [{ type: "stat", id: "stat-total", label: title, field: "version" }],
  }],
  adminResources: [{
    id: "catalog-items",
    viewId: "catalog-view",
    modelKey: "catalog_items",
    fields: ["title_en", "status"],
  }],
  adminDomainWorkflows: [{
    schemaVersion: 1,
    viewId: "catalog-view",
    routeId: "catalog",
    resourceId: "catalog-items",
    idField: "recordId",
    versionField: "expectedVersion",
    operationField: "operation",
    operations: ["create", "save", "publish"],
    fields: [{ key: "title_en", label: title, maxLength: 120 }],
  }],
};
`,
    );

    // Compile with tsc --noEmit
    expect(() => {
      execFileSync("npx", ["tsc", "-p", "tsconfig.json"], {
        cwd: consumerDir,
        stdio: "pipe",
      });
    }).not.toThrow();
  });

  it("strictly rejects external consumer attempts to import private Host internal packages", () => {
    expect(tmpConsumerDir).toBeTruthy();
    const consumerDir = tmpConsumerDir!;

    fs.writeFileSync(
      path.join(consumerDir, "invalid-consumer.ts"),
      `
import { SDK_VERSION } from "@vibress/plugin-sdk";
import { getDb } from "@vibress/database";
`,
    );

    // tsc must fail compilation due to unresolvable Host private module
    expect(() => {
      execFileSync(
        "npx",
        ["tsc", "--noEmit", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "invalid-consumer.ts"],
        {
          cwd: consumerDir,
          stdio: "pipe",
        },
      );
    }).toThrow();
  });

  it("admits a packaged external plugin conforming to public SDK contracts", () => {
    const pageOutcome = admitNativeAdminPage(packagedExternalPlugin, "catalog-view");
    expect(pageOutcome.kind).toBe("admitted");
    if (pageOutcome.kind === "admitted") {
      const parsed = ExtensionNativeAdminPageV1Schema.safeParse(pageOutcome.page);
      expect(parsed.success).toBe(true);
    }

    const dataOutcome = admitNativeDataRegistry(packagedExternalPlugin);
    expect(dataOutcome.kind).toBe("admitted");

    const workflowOutcome = admitNativeDomainWorkflow(packagedExternalPlugin, "catalog-view");
    expect(workflowOutcome.kind).toBe("admitted");
    if (workflowOutcome.kind === "admitted") {
      const parsed = ExtensionNativeDomainWorkflowV1Schema.safeParse(workflowOutcome.workflow);
      expect(parsed.success).toBe(true);
    }
  });

  it("admits legacy plugins without Native declarations as absent without failure", () => {
    const legacyPlugin: PluginModule = {
      activate() {},
      routes: packagedExternalPlugin.routes?.slice(0, 1),
      adminViews: packagedExternalPlugin.adminViews,
      adminNavigation: packagedExternalPlugin.adminNavigation,
    };

    expect(admitNativeAdminPage(legacyPlugin, "catalog-view").kind).toBe("absent");
    expect(admitNativeDataRegistry(legacyPlugin).kind).toBe("absent");
    expect(admitNativeDomainWorkflow(legacyPlugin, "catalog-view").kind).toBe("absent");
  });

  it("fails closed when external plugin attempts to bind a workflow to an undeclared view", () => {
    const workflow = packagedExternalPlugin.adminDomainWorkflows?.[0];
    if (!workflow) throw new Error("Missing workflow fixture");

    const corruptedPlugin: PluginModule = {
      ...packagedExternalPlugin,
      adminDomainWorkflows: [
        {
          ...workflow,
          viewId: "nonexistent-view-id",
        },
      ],
    };

    const outcome = admitNativeDomainWorkflow(corruptedPlugin, "catalog-view");
    expect(outcome.kind).toBe("invalid");
  });

  it("fails closed when external plugin specifies an unapproved component type", () => {
    const page = packagedExternalPlugin.adminPages?.[0];
    if (!page) throw new Error("Missing page fixture");

    const corruptedPlugin: PluginModule = {
      ...packagedExternalPlugin,
      adminPages: [
        {
          ...page,
          components: [
            // @ts-expect-error Testing runtime schema defense against invalid component type
            { type: "arbitrary-iframe-inject", id: "bad", label, field: "count" },
          ],
        },
      ],
    };

    const outcome = admitNativeAdminPage(corruptedPlugin, "catalog-view");
    expect(outcome.kind).toBe("invalid");
  });

  it("fails closed when external plugin specifies an unapproved schemaVersion", () => {
    const page = packagedExternalPlugin.adminPages?.[0];
    if (!page) throw new Error("Missing page fixture");

    const corruptedPlugin: PluginModule = {
      ...packagedExternalPlugin,
      adminPages: [
        {
          ...page,
          // @ts-expect-error Testing runtime schema defense against unsupported schemaVersion
          schemaVersion: 999,
        },
      ],
    };

    const outcome = admitNativeAdminPage(corruptedPlugin, "catalog-view");
    expect(outcome.kind).toBe("invalid");
  });
});
