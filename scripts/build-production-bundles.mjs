#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const req = createRequire(import.meta.url);
const esbuildPath = req.resolve('esbuild', { paths: [req.resolve('tsx')] });
const esbuild = req(esbuildPath);

const BANNER = {
  js: `import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameFunc } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameFunc(__filename);`,
};

const COMMON_CONFIG = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['argon2'],
  banner: BANNER,
  sourcemap: false,
};

async function buildAll() {
  console.log('Building production bundles with esbuild...');
  const start = Date.now();

  // Ensure output directories exist
  fs.mkdirSync('apps/api/dist', { recursive: true });
  fs.mkdirSync('apps/worker/dist', { recursive: true });
  fs.mkdirSync('packages/database/dist', { recursive: true });

  await Promise.all([
    // 1. API entrypoint
    esbuild.build({
      ...COMMON_CONFIG,
      entryPoints: ['apps/api/src/main.ts'],
      outfile: 'apps/api/dist/main.js',
    }),
    // 2. Worker entrypoint
    esbuild.build({
      ...COMMON_CONFIG,
      entryPoints: ['apps/worker/src/main.ts'],
      outfile: 'apps/worker/dist/main.js',
    }),
    // 3. Standalone migration entrypoint (built into both api dist and database dist)
    esbuild.build({
      ...COMMON_CONFIG,
      entryPoints: ['packages/database/src/migrate.ts'],
      outfile: 'apps/api/dist/migrate.js',
    }),
    esbuild.build({
      ...COMMON_CONFIG,
      entryPoints: ['packages/database/src/migrate.ts'],
      outfile: 'packages/database/dist/migrate.js',
    }),
  ]);

  // Mark dist directories as native ES modules
  const esmPackageJson = JSON.stringify({ type: 'module' }, null, 2) + '\n';
  fs.writeFileSync('apps/api/dist/package.json', esmPackageJson);
  fs.writeFileSync('apps/worker/dist/package.json', esmPackageJson);
  fs.writeFileSync('packages/database/dist/package.json', esmPackageJson);

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`Production bundles successfully built in ${duration}s.`);
}

buildAll().catch((err) => {
  console.error('Production bundle build failed:', err);
  process.exit(1);
});
