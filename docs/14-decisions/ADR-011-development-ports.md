# ADR-011: Vibress Development Port Convention

**Status:** Accepted  
**Architecture version:** v1

## Decision

Vibress adopts **port `7777`** as the official unified development entrypoint.

Developers should access the project through:

```text
http://localhost:7777
```

The development gateway/reverse proxy routes requests internally to the appropriate Vibress application.

## Port allocation

| Service                           |     Port |
| --------------------------------- | -------: |
| Vibress Gateway / Main URL        | **7777** |
| Public Web                        |     7778 |
| Admin                             |     7779 |
| API                               |     7780 |
| Portal                            |     7781 |
| Worker health/metrics, if enabled |     7782 |

Infrastructure services keep their standard internal ports unless a local conflict requires remapping:

| Service    | Default internal port |
| ---------- | --------------------: |
| PostgreSQL |                  5432 |
| Redis      |                  6379 |

## Routing convention

```text
localhost:7777
      │
      ├── /           → Public Web
      ├── /admin      → Admin
      ├── /portal     → Portal
      └── /api        → API
```

## Rationale

- `7777` is easy to remember and identify as the Vibress development entrypoint.
- It avoids commonly used application development ports such as `3000`, `5173`, and `8080`.
- A single external development URL reduces CORS, cookie, session, and OAuth complexity between Vibress applications.
- Consecutive internal ports make service allocation predictable.

## Production

Port `7777` is a development convention only.

Production traffic should normally terminate on standard HTTPS port `443` through a reverse proxy, load balancer, or CDN.

Example:

```text
https://example.com
https://example.com/admin
https://example.com/api
https://example.com/portal
```

## Configuration

Recommended environment variables:

```text
VIBRESS_PORT=7777
WEB_PORT=7778
ADMIN_PORT=7779
API_PORT=7780
PORTAL_PORT=7781
WORKER_HEALTH_PORT=7782
```

The gateway should be the only application endpoint developers need to use directly during normal development.

## Conflict handling

No port can be guaranteed to be unused on every machine.

If `7777` is already occupied locally, a developer may override it through environment configuration. The canonical/default Vibress port remains `7777`.
