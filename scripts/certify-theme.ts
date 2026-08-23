import { certifyTheme } from "@vibress/theme-core";
import * as fs from "node:fs";
import * as path from "node:path";

function loadDir(dir: string, files: Map<string, Buffer>, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      loadDir(fullPath, files, relPath);
    } else {
      files.set(relPath, fs.readFileSync(fullPath));
    }
  }
}

const themeDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(process.cwd(), "content/theme-starter");

if (!fs.existsSync(themeDir)) {
  console.error(`Theme directory not found: ${themeDir}`);
  process.exit(1);
}

const files = new Map<string, Buffer>();
loadDir(themeDir, files);

const report = certifyTheme({ files });

console.log(JSON.stringify(report, null, 2));

if (!report.certified) {
  console.error(`Theme certification failed for ${report.themeId} with score ${report.score}/100.`);
  process.exit(1);
} else {
  console.log(`Theme certified successfully with score ${report.score}/100.`);
}
