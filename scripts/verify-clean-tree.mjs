#!/usr/bin/env node
/**
 * Verifies the Git tree is clean of generated pollution after a build
 * (H10: "Build leaves clean Git tree" / "CI detects generated pollution").
 *
 * Exits non-zero if `git status --porcelain` reports any modified or
 * untracked files. CI runs this after `pnpm build`; a dirty tree means
 * a build (or tool) wrote artifacts into tracked locations.
 */
import { execSync } from 'node:child_process';

const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();

if (status === '') {
  console.log('clean-tree: Git tree is clean after build.');
  process.exit(0);
}

console.error('clean-tree: FAIL — build left the Git tree dirty:');
console.error(status);
process.exit(1);