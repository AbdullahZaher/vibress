# Vibress Studio

## Product definition

**Vibress Studio** is the standalone editor used by Vibress.

It is intentionally separate from Vibress Core and should be distributed as reusable packages.

The editor architecture follows the strengths of structured editing while being branded and organized as Vibress Studio.

## Repository

```text
vibress-studio/
├── packages/
│   ├── studio-core/
│   ├── studio-react/
│   ├── studio-nodes/
│   ├── studio-cards/
│   ├── studio-renderer/
│   ├── studio-serializer/
│   ├── studio-html/
│   ├── studio-markdown/
│   ├── studio-email/
│   ├── studio-plugin-sdk/
│   └── studio-testing/
│
├── cards/
│   ├── image/
│   ├── gallery/
│   ├── video/
│   ├── audio/
│   ├── file/
│   ├── bookmark/
│   ├── embed/
│   ├── button/
│   ├── callout/
│   ├── toggle/
│   ├── code/
│   ├── markdown/
│   ├── html/
│   └── paywall/
│
├── playground/
├── tests/
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── nx.json
└── README.md
```

## Editor engine

Recommended base: Lexical.

## Package responsibilities

### `studio-core`

Editor state, commands, history, selection, shared extension contracts.

### `studio-react`

React components and bindings.

### `studio-nodes`

Paragraph, heading, quote, list, text, and custom node definitions.

### `studio-cards`

Reusable rich content blocks.

### `studio-serializer`

Canonical Studio document serialization.

### `studio-renderer`

Renderer orchestration.

### `studio-html`

Web HTML output.

### `studio-markdown`

Markdown conversion.

### `studio-email`

Email-safe HTML output.

### `studio-plugin-sdk`

Public contracts for third-party editor extensions.

## Independence rule

Vibress Studio may know about:

- upload callback contracts
- generic link resolution
- generic feature flags
- generic card/plugin registration

It must not import:

- Vibress database
- Vibress post domain internals
- Vibress auth internals
- Vibress storage implementation
