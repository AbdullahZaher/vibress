#!/usr/bin/env node
/** M00-E04 — generate or verify the CMS/Studio compatibility manifest. */
import fs from "node:fs";
import path from "node:path";
import {
  OUTPUT_PATH,
  buildCmsCompatibilityManifest,
  validateCmsManifest,
} from "./platform/compatibility/cms-compatibility-manifest.mjs";
import { repoRootFromModule } from "./platform/inventory/repository-inventory.mjs";

const root = repoRootFromModule();
const generated = buildCmsCompatibilityManifest(root);
const errors = validateCmsManifest(generated);
if (process.argv.includes("--write")) {
  const file = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({
  dimensions: generated.dimensions.length,
  pinnedDigest: generated.fixturePack.pinnedDigestConstant,
  errors,
}, null, 2));
if (errors.length) process.exit(1);
