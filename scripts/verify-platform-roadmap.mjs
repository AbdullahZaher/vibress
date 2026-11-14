#!/usr/bin/env node
/**
 * Offline, deterministic validation for docs/platform-roadmap.
 * No npm install, API token, network, or runtime/database credentials needed.
 * This checks document structure; it does NOT establish implementation or security certification.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(repoRoot, 'docs/platform-roadmap');
const issues = [];
const mdFiles = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.isFile() && item.name.endsWith('.md')) mdFiles.push(full);
  }
}
function rel(p) { return path.relative(repoRoot, p).split(path.sep).join('/'); }
function fail(where, message) { issues.push(rel(where) + ': ' + message); }
function headings(text) {
  const count = new Map();
  const slugs = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    let s = m[1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]*>/g, '').replace(/[*~\`]/g, '')
      .toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    const occurrences = count.get(s) ?? 0;
    count.set(s, occurrences + 1);
    if (occurrences) s += '-' + occurrences;
    slugs.add(s);
  }
  return slugs;
}
function checkLinks(source, content) {
  for (const m of content.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
    const raw = m[1].trim().replace(/\s+["'][^"']*["']$/, '').replace(/^<|>$/g, '');
    if (!raw || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(raw)) continue;
    const [pathname, fragment] = raw.split('#', 2);
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { fail(source, 'invalid URI encoding in link: ' + raw); continue; }
    const target = path.resolve(path.dirname(source), decoded || '.');
    const relative = path.relative(repoRoot, target);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      fail(source, 'relative link escapes repository: ' + raw); continue;
    }
    if (!fs.existsSync(target)) { fail(source, 'missing link target: ' + raw); continue; }
    if (fragment && target.endsWith('.md') && fs.statSync(target).isFile()) {
      let decodedFragment = '';
      try { decodedFragment = decodeURIComponent(fragment); }
      catch { fail(source, 'bad fragment encoding in link: ' + raw); continue; }
      const anchors = headings(fs.readFileSync(target, 'utf8'));
      if (!anchors.has(decodedFragment.toLowerCase())) {
        fail(source, 'missing Markdown heading anchor: ' + raw);
      }
    }
  }
}
if (!fs.existsSync(docsRoot)) { console.error('Roadmap docs directory is missing'); process.exit(1); }
walk(docsRoot);
const expectedIds = Array.from({ length: 13 }, (_, i) => 'M' + String(i).padStart(2, '0'));
const milestoneFiles = mdFiles.filter(p => path.dirname(p) === path.join(docsRoot, 'milestones'));
const milestoneById = new Map();
const globalEpics = new Set();
let epicCount = 0;
let acceptanceChecks = 0;
for (const file of mdFiles) {
  const body = fs.readFileSync(file, 'utf8');
  checkLinks(file, body);
  if (!milestoneFiles.includes(file)) continue;
  const id = path.basename(file).slice(0, 3);
  if (!expectedIds.includes(id)) fail(file, 'unrecognized milestone filename ID ' + id);
  if (milestoneById.has(id)) fail(file, 'duplicate milestone file ID ' + id);
  milestoneById.set(id, file);
  if (!body.startsWith('# ' + id + ' ' ) && !body.startsWith('# ' + id + ' —')) {
    fail(file, 'first heading does not identify milestone ' + id);
  }
  const epics = [...body.matchAll(/^###\s+(M\d{2}-E\d{2})\s+—\s+.+$/gm)];
  if (!epics.length) fail(file, 'no epics found');
  for (const epic of epics) {
    if (!epic[1].startsWith(id + '-')) fail(file, 'cross-milestone epic: ' + epic[1]);
    if (globalEpics.has(epic[1])) fail(file, 'duplicate epic ID: ' + epic[1]);
    globalEpics.add(epic[1]); epicCount++;
  }
  acceptanceChecks += [...body.matchAll(/^- \[ \] /gm)].length;
  if (!body.includes('## Milestone closure evidence ledger')) fail(file, 'no milestone evidence ledger');
}
for (const id of expectedIds) if (!milestoneById.has(id)) fail(docsRoot, 'missing milestone ' + id);
if (milestoneFiles.length !== 13) fail(docsRoot, 'expected 13 milestone documents; got ' + milestoneFiles.length);

const read = name => fs.readFileSync(path.join(docsRoot, name), 'utf8');
const tracker = read('MILESTONE-TRACKER.md');
const master = read('README.md');
for (const [index, id] of expectedIds.entries()) {
  const issue = 152 + index;
  const row = tracker.split('\n').filter(line => line.startsWith('| ' + id + ' |'));
  if (row.length !== 1) fail(path.join(docsRoot, 'MILESTONE-TRACKER.md'), 'expected one row for ' + id);
  if (row.length && !row[0].includes('/issues/' + issue + ')')) {
    fail(path.join(docsRoot, 'MILESTONE-TRACKER.md'), 'wrong GitHub tracking issue for ' + id);
  }
  if (!master.includes('[' + id + '](milestones/')) {
    fail(path.join(docsRoot, 'README.md'), 'missing master milestone link for ' + id);
  }
}
if (!tracker.includes('/issues/165')) fail(path.join(docsRoot, 'MILESTONE-TRACKER.md'), 'missing central program issue');
if (!master.includes('CMS') || !master.includes('CRM')) fail(path.join(docsRoot, 'README.md'), 'v1 CMS + CRM minimum absent');
if (!read('EXECUTION-FIRST-SLICE.md').includes('P0')) fail(path.join(docsRoot, 'EXECUTION-FIRST-SLICE.md'), 'priority gate missing');
const scoreText = read('SECOND-REVIEW-AND-SCORECARD-2026-11-14.md');
const rows = [...scoreText.matchAll(/^\| (?!\*\*TOTAL\*\*)(?!Criterion\b)[^|\n]+\| (\d+(?:\.\d+)?) \| \*\*(\d+(?:\.\d+)?)\*\* \|/gm)];
if (rows.length !== 8) fail(path.join(docsRoot, 'SECOND-REVIEW-AND-SCORECARD-2026-11-14.md'), 'expected 8 rubric rows');
const max = rows.reduce((sum, row) => sum + Number(row[1]), 0);
const score = rows.reduce((sum, row) => sum + Number(row[2]), 0);
if (Math.abs(max - 10) > 0.001 || Math.abs(score - 8) > 0.001) {
  fail(path.join(docsRoot, 'SECOND-REVIEW-AND-SCORECARD-2026-11-14.md'), 'historical weighted rubric totals do not equal 10 / 8');
}
if (issues.length) {
  console.error('Roadmap documentation validation FAILED (' + issues.length + ' issue(s)):');
  for (const issue of issues) console.error(' - ' + issue);
  process.exit(1);
}
console.log('Roadmap documentation validation PASSED');
console.log(JSON.stringify({ markdownFiles: mdFiles.length, milestones: milestoneFiles.length, uniqueEpics: epicCount, acceptanceChecks, historicalRubric: score + '/' + max }, null, 2));
