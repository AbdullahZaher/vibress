# Docker Deployment Guide for Vibress

This guide details the container topology, volumes, security constraints, and maintenance workflows for running **Vibress** with Docker Compose.

---

## 1. Services Defined in `compose.prod.yml`

| Service | Image / Build Context | Network | Ports Exposed | Purpose |
| :--- | :--- | :--- | :---: | :--- |
| **`gateway`** | `docker/gateway.Dockerfile` | `frontend` | `7777:8080` | Public reverse proxy entry point. |
| **`web`** | `docker/web.Dockerfile` | `frontend` | None | Next.js SSR public frontend. |
| **`admin`** | `docker/spa.Dockerfile` (admin) | `frontend` | None | React/Vite Admin dashboard. |
| **`portal`** | `docker/spa.Dockerfile` (portal) | `frontend` | None | React/Vite Member portal. |
| **`api`** | `docker/api.Dockerfile` | `frontend`, `backend` | None | Core Fastify REST API. |
| **`worker`** | `docker/worker.Dockerfile` | `frontend`, `backend` | None | BullMQ worker & outbox dispatcher. |
| **`postgres`**| `postgres:16-alpine` | `backend` | None | Persisted relational database. |
| **`redis`** | `redis:7-alpine` | `backend` | None | In-memory cache & job queue. |
| **`migrate`** | `docker/api.Dockerfile` | `backend` | None | One-shot migration bootstrapper. |

---

## 2. Network Isolation Architecture

Vibress implements strict two-tier network isolation:

```text
[Public Traffic] ──► [gateway (frontend)]
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
      [web, admin, portal]           [api, worker]
          (frontend)              (frontend, backend)
                                          │
                                          ▼
                                 [postgres, redis]
                               (backend: internal-only)
```

* **`frontend` Network:** Connects the gateway to the application containers.
* **`backend` Network (`internal: true`):** Connects API and Worker to PostgreSQL and Redis. This network has no external route or gateway access, preventing database and Redis exposure to the public internet.

---

## 3. Persistent Volumes

| Volume Name | Target Mount Point | Content Type | Backup Requirement |
| :--- | :--- | :--- | :---: |
| **`postgres_data`** | `/var/lib/postgresql/data` | Relational tables & indexes | **Critical (Daily Dump)** |
| **`redis_data`** | `/data` | AOF append-only queue logs | Ephemeral / Reconstructible |
| **`vibress_content`**| `/repo/apps/api/content` | Uploaded media & theme files | **Critical (Sync to S3/Cold)** |

---

## 4. Container Security Controls

* **Non-Root Runtime:** All Node.js containers run under the unprivileged `node` user (UID 1000). The NGINX gateway runs as `101`.
* **Minimal Base Images:** Built on Alpine Linux (`node:24-alpine`, `nginxinc/nginx-unprivileged:1.27-alpine`).
* **Dependency Pruning:** Build tools, devDependencies, and npm CLI are stripped from final runtime image layers.
* **Health Probes:** Every container specifies native Docker `HEALTHCHECK` instructions.

---

## 5. Standard Docker Operations

### Starting the Stack
```bash
docker compose -f compose.prod.yml up -d --build
```

### Checking Container Logs
```bash
# View all logs
docker compose -f compose.prod.yml logs -f

# View API logs only
docker compose -f compose.prod.yml logs -f api

# View Worker logs only
docker compose -f compose.prod.yml logs -f worker
```

### Stopping the Stack
```bash
docker compose -f compose.prod.yml down
```

### Restarting a Single Service
```bash
docker compose -f compose.prod.yml restart worker
```
