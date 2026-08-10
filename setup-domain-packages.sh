#!/bin/bash
set -e

mkdir -p packages/domains

DOMAINS=(
  "auth" "users" "roles" "permissions"
  "posts" "pages" "tags" "authors" "revisions"
  "media" "files"
  "members" "comments"
  "products" "plans" "offers" "subscriptions" "billing"
  "newsletters" "email"
  "analytics" "recommendations" "search"
  "integrations" "webhooks" "automations"
  "themes" "settings" "audit" "notifications"
)

for domain in "${DOMAINS[@]}"; do
  mkdir -p "packages/domains/$domain/src/domain"
  mkdir -p "packages/domains/$domain/src/application"
  mkdir -p "packages/domains/$domain/src/queries"
  mkdir -p "packages/domains/$domain/src/infrastructure"
  mkdir -p "packages/domains/$domain/tests"
  
  # Basic package.json
  cat << PKG > "packages/domains/$domain/package.json"
{
  "name": "@vibress/$domain",
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
  cat << TSCONFIG > "packages/domains/$domain/tsconfig.json"
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
TSCONFIG

  # Minimal index file
  echo "export const name = '@vibress/$domain';" > "packages/domains/$domain/src/index.ts"
done

echo "Domain packages scaffolded."
