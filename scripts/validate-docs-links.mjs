#!/usr/bin/env node
/**
 * Validates that relative Markdown links in the given docs roots resolve to
 * files in this checkout.
 *
 * Usage: node scripts/validate-docs-links.mjs [docs-root ...]
 * Defaults to `docs`. External URLs, mail links and pure in-page anchors are
 * ignored; fenced code blocks are skipped. Exits non-zero on broken links so
 * docs rot is caught before merge (M00 documentation validator).
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const roots = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

if (roots.length === 0) {
  roots.push("docs");
}

// Inline links/images: [text](target "title") and ![alt](<target with spaces>).
const LINK_PATTERN = /\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const SKIP_PREFIXES = [
  "#",
  "http://",
  "https://",
  "mailto:",
  "tel:",
  "data:",
  "file:",
  "//",
];

const markdownFiles = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".md"))
      markdownFiles.push(fullPath);
  }
}

for (const root of roots) {
  const absoluteRoot = path.resolve(repoRoot, root);
  if (!fs.existsSync(absoluteRoot)) {
    console.error(`docs-links: FAIL — path does not exist: ${root}`);
    process.exit(1);
  }
  collect(absoluteRoot);
}

let linkCount = 0;
const broken = [];

for (const file of markdownFiles.sort()) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inFence = false;

  lines.forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // Inline code spans may contain literal link syntax; ignore it.
    const searchable = line.replace(/`[^`]*`/g, "");

    for (const match of searchable.matchAll(LINK_PATTERN)) {
      const captured = match[1];
      if (!captured) continue;
      const target =
        captured.startsWith("<") && captured.endsWith(">")
          ? captured.slice(1, -1)
          : captured;
      if (!target || SKIP_PREFIXES.some((prefix) => target.startsWith(prefix)))
        continue;
      if (target.includes("${")) continue;

      linkCount += 1;
      const withoutFragment = target.split("#")[0].split("?")[0];
      if (!withoutFragment) continue;

      let decoded = withoutFragment;
      try {
        decoded = decodeURIComponent(withoutFragment);
      } catch {
        // Keep the raw target when it is not valid percent-encoding.
      }

      const resolved = decoded.startsWith("/")
        ? path.resolve(repoRoot, `.${decoded}`)
        : path.resolve(path.dirname(file), decoded);

      if (!fs.existsSync(resolved)) {
        broken.push({ file, line: index + 1, target });
      }
    }
  });
}

if (broken.length > 0) {
  console.error(
    `docs-links: FAIL — ${broken.length} broken link(s) in ${markdownFiles.length} file(s):`,
  );
  for (const entry of broken) {
    console.error(
      `  ${path.relative(repoRoot, entry.file)}:${entry.line} -> ${entry.target}`,
    );
  }
  process.exit(1);
}

console.log(
  `docs-links: OK — ${linkCount} relative link(s) across ${markdownFiles.length} file(s) resolve.`,
);
