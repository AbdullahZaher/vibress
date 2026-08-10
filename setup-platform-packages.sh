#!/bin/bash
set -e

mkdir -p packages

PACKAGES=(
  "config"
  "observability"
  "database"
  "queue"
  "cache"
  "storage-core"
  "events"
  "security"
  "api-contracts"
  "plugin-core"
  "plugin-sdk"
  "ui"
  "i18n"
  "utils"
  "testing"
)

for pkg in "${PACKAGES[@]}"; do
  mkdir -p "packages/$pkg/src"
  
  # Basic package.json
  cat << PKG > "packages/$pkg/package.json"
{
  "name": "@vibress/$pkg",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "lint": "eslint \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "workspace:*",
    "@types/node": "workspace:*"
  }
}
PKG

  # Basic tsconfig.json
  cat << TSCONFIG > "packages/$pkg/tsconfig.json"
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
TSCONFIG

  # Minimal index file
  echo "export const name = '@vibress/$pkg';" > "packages/$pkg/src/index.ts"
done

echo "Platform packages scaffolded."
