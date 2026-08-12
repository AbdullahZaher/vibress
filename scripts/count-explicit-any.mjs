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
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const maxArg = args.indexOf('--max');
const maxAllowed = maxArg !== -1 ? parseInt(args[maxArg + 1], 10) : 120;
const report = args.includes('--report');

const PATTERN = String.raw`:\s*any\b|\bany\b\s*[\[\]]|\bas any\b|<any>|Array<any>|Promise<any>|Record<string,\s*any>|z\.any\s*\(`;
const globs = [
  'apps',
  'packages',
];

const files = execSync(
  `rg -l "${PATTERN}" ${globs.join(' ')} --glob '*.{ts,tsx}' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' --glob '!**/tests/**' --glob '!**/dist/**' --glob '!**/node_modules/**' 2>/dev/null || true`,
  { encoding: 'utf8', cwd: process.cwd() }
)
  .split('\n')
  .filter(Boolean);

let total = 0;
const perFile = [];
for (const file of files) {
  const out = execSync(
    `rg -o "${PATTERN}" "${file}" | wc -l`,
    { encoding: 'utf8', cwd: process.cwd() }
  );
  const count = parseInt(out.trim(), 10) || 0;
  total += count;
  if (count > 0) perFile.push({ file, count });
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
