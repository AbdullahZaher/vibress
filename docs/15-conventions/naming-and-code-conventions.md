# Naming and Code Conventions

## Package names

Official packages should use the `@vibress/*` namespace.

Examples:

```text
@vibress/posts
@vibress/members
@vibress/database
@vibress/storage-core
@vibress/plugin-sdk
@vibress/studio-react
```

## File names

Use kebab-case:

```text
create-post.ts
storage-provider.ts
plugin-manager.ts
```

## Types and classes

Use PascalCase:

```text
CreatePostUseCase
StorageProvider
PluginManifest
```

## Functions and variables

Use camelCase.

## Events

Use dot-separated lowercase names:

```text
post.published
member.created
subscription.cancelled
```

## Environment variables

Use uppercase snake case:

```text
DATABASE_URL
REDIS_URL
VIBRESS_ENCRYPTION_KEY
```

## Database

Use snake_case table/column names.

## API

Use plural resource names.

```text
/posts
/members
/newsletters
```

## Error codes

Use stable uppercase machine-readable codes.

```text
POST_NOT_FOUND
INVALID_STORAGE_CREDENTIALS
PERMISSION_DENIED
```
