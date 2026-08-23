import {
  generateTranslationCoverageReport,
  formatCoverageReportAsMarkdown,
  enDictionary,
  arDictionary,
} from "@vibress/i18n";
import * as fs from "node:fs";
import * as path from "node:path";

// Load Starter Theme dictionaries as well
const starterDir = path.resolve(process.cwd(), "content/theme-starter/locales");
let themeEn = {};
let themeAr = {};

try {
  themeEn = JSON.parse(fs.readFileSync(path.join(starterDir, "en.json"), "utf-8"));
  themeAr = JSON.parse(fs.readFileSync(path.join(starterDir, "ar.json"), "utf-8"));
} catch {
  // Optional
}

const combinedSource = {
  ...enDictionary,
  theme: themeEn,
};

const targetDicts = {
  "ar-SA": {
    ...arDictionary,
    theme: themeAr,
  },
};

const report = generateTranslationCoverageReport(combinedSource, targetDicts, "en-US");

console.log(formatCoverageReportAsMarkdown(report));
console.log("\nMachine-readable JSON:");
console.log(JSON.stringify(report, null, 2));
