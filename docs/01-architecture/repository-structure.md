# Repository Structure

## Main repository

```text
vibress/
├── apps/
│   ├── admin/
│   ├── web/
│   ├── api/
│   ├── worker/
│   └── portal/
│
├── packages/
│   ├── domains/
│   ├── database/
│   ├── api-contracts/
│   ├── events/
│   ├── queue/
│   ├── cache/
│   ├── storage-core/
│   ├── plugin-core/
│   ├── plugin-sdk/
│   ├── security/
│   ├── observability/
│   ├── config/
│   ├── ui/
│   ├── i18n/
│   ├── utils/
│   └── testing/
│
├── infrastructure/
├── content/
├── tests/
├── scripts/
├── docs/
├── .github/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── nx.json
├── tsconfig.base.json
├── eslint.config.js
├── compose.dev.yml
└── Dockerfile
```

## Runtime applications

`apps/*` contains deployable processes or frontends.

These applications may orchestrate domain use cases, but they must not define core business rules.

## Shared packages

`packages/*` contains domain code and reusable platform contracts.

## Runtime content

`content/` is operational data and should be mounted as a persistent volume where local storage is used.

```text
content/
├── images/
├── media/
├── files/
├── avatars/
├── themes/
├── plugins/
├── exports/
├── logs/
└── temp/
```
