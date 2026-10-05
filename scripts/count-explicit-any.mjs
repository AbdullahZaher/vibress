#!/usr/bin/env node
/**
 * Repo-health guard: fails when the explicit-any count in production source
 * exceeds the allowed threshold.
 *
 * Counting rule — only actual TYPE usage counts, comments do not:
 *   - `: any`, ` as any`, `<any>`, `any[]`, `Array<any>`, `Promise<any>`,
 *     `Record<string, any>`, `z.any(`
 *
 * Usage: node scripts/count-explicit-any.mjs [--max N] [--report]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const maxArg = args.indexOf('--max');
const maxAllowed = maxArg !== -1 ? parseInt(args[maxArg + 1], 10) : 120;
const report = args.includes('--report');

const PATTERN = /:\s*any\b|\bany\b\s*[\[\]]|\bas any\b|<any>|Array<any>|Promise<any>|Record<string,\s*any>|z\.any\s*\(/g;
const roots = ['apps', 'packages'];

function shouldIgnore(filePath) {
  const p = filePath.split(path.sep).join('/');
  if (p.includes('/node_modules/') || p.includes('/dist/') || p.includes('/tests/') || p.includes('/.next/')) return true;
  if (p.endsWith('.test.ts') || p.endsWith('.spec.ts') || p.endsWith('.test.tsx') || p.endsWith('.spec.tsx')) return true;
  return false;
}

function findFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (shouldIgnore(fullPath)) continue;
      if (entry.isDirectory()) {
        results = results.concat(findFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory unreadable or does not exist
  }
  return results;
}

let total = 0;
const perFile = [];
for (const root of roots) {
  const files = findFiles(root);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(PATTERN);
    if (matches && matches.length > 0) {
      total += matches.length;
      perFile.push({ file, count: matches.length });
    }
  }
}

if (report) {
  console.log(`Explicit-any count: ${total}`);
  for (const { file, count } of perFile) {
    console.log(`  ${count}  ${file}`);
  }
}

if (total > maxAllowed) {
  console.error(`\nExplicit-any count ${total} exceeds allowed maximum ${maxAllowed}.`);
  console.error('Reduce explicit `any` usage (prefer unknown + Zod parsing, Record<string, unknown>, discriminated unions).');
  process.exit(1);
}

console.log(`explicit-any OK: ${total} (max ${maxAllowed})`);
