#!/bin/bash
set -e

# Initialize package.json
cat << 'PKG' > package.json
{
  "name": "vibress-monorepo",
  "private": true,
  "scripts": {
    "dev": "nx run-many --target=dev --all --parallel=5",
    "dev:infra": "docker-compose -f compose.dev.yml up -d",
    "dev:infra:down": "docker-compose -f compose.dev.yml down",
    "build": "nx run-many --target=build --all",
    "lint": "nx run-many --target=lint --all",
    "typecheck": "nx run-many --target=typecheck --all",
    "test": "nx run-many --target=test --all",
    "test:unit": "nx run-many --target=test:unit --all",
    "test:integration": "nx run-many --target=test:integration --all",
    "test:e2e": "nx run-many --target=test:e2e --all",
    "db:generate": "pnpm --filter @vibress/database run db:generate",
    "db:migrate": "pnpm --filter @vibress/database run db:migrate",
    "db:seed": "pnpm --filter @vibress/database run db:seed",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,yml,yaml,html,css}\""
  }
}
PKG

# Create pnpm-workspace.yaml
cat << 'PNPM' > pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'packages/domains/*'
PNPM

# Create nx.json
cat << 'NX' > nx.json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": [
      "default",
      "!{projectRoot}/**/?(*.)+(spec|test).[jt]s?(x)?(.snap)",
      "!{projectRoot}/tsconfig.spec.json",
      "!{projectRoot}/jest.config.[jt]s",
      "!{projectRoot}/.eslintrc.json"
    ],
    "sharedGlobals": []
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "cache": true
    },
    "lint": {
      "inputs": ["default", "{workspaceRoot}/.eslintrc.json"],
      "cache": true
    },
    "test": {
      "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"],
      "cache": true
    },
    "typecheck": {
      "inputs": ["default", "^production"],
      "cache": true
    }
  }
}
NX

# Create tsconfig.base.json
cat << 'TSCONFIG' > tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "composite": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "tmp"]
}
TSCONFIG

# Create .env.example
cat << 'ENV' > .env.example
NODE_ENV=development

VIBRESS_PORT=7777

WEB_PORT=7778
ADMIN_PORT=7779
API_PORT=7780
PORTAL_PORT=7781
WORKER_HEALTH_PORT=7782

DATABASE_URL=postgresql://vibress:vibress@localhost:5432/vibress
REDIS_URL=redis://localhost:6379

VIBRESS_ENCRYPTION_KEY=$(openssl rand -hex 32 2>/dev/null || echo "change-me-64-hex-chars-generated-by-openssl-rand-hex-32")

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=vibress
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_PUBLIC_URL=http://localhost:9000/vibress

SENTRY_DSN=
ENV

# Copy .env.example to .env
cp .env.example .env

# Create .gitignore
cat << 'GITIGNORE' > .gitignore
node_modules/
dist/
build/
.next/
out/
.nx/
coverage/
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
content/*
!content/.gitkeep
tmp/
GITIGNORE

# Install dependencies
pnpm add -w -D nx typescript eslint prettier vitest @playwright/test tsx @types/node

echo "Workspace initialized."
