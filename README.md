# Vibress

Vibress is a modern publishing/CMS and membership platform inspired by the capabilities of systems such as Ghost, but built with a different architecture and technology stack.

## Architecture Overview

Vibress uses a single deployment that hosts multiple runtime applications, divided into explicit domain packages with enforced dependency boundaries using `pnpm` and `Nx`.
The core technology stack includes:
- TypeScript
- pnpm
- Nx
- React + Vite
- Next.js
- Fastify
- PostgreSQL
- Drizzle ORM
- Redis
- BullMQ
- Lexical-based Vibress Studio
- Docker
- Playwright
- Vitest

## Repository Structure

- **`apps/`**: Deployable processes:
  - `admin`: Admin dashboard
  - `web`: Public frontend
  - `api`: Core backend
  - `worker`: Background job processing
  - `portal`: Member portal
- **`packages/`**: Domain code and reusable platform contracts.
- **`infrastructure/`**: Docker and local development services.
- **`docs/`**: Comprehensive project documentation.

## Requirements

- [Node.js](https://nodejs.org/) (v24+ — `>=24.0.0 <25`, pinned in `engines`)
- [pnpm](https://pnpm.io/) (v11.17.0 — pinned via `packageManager`)
- [Docker & Docker Compose](https://www.docker.com/)

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/AbdullahZaher/vibress.git
   cd vibress
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

## Environment Configuration

Copy the example environment file and configure it as needed. The `.env.example` contains safe local development defaults.
```bash
cp .env.example .env
```
Ensure you generate a secure `VIBRESS_ENCRYPTION_KEY` for production deployments.

## How to Run Locally

1. **Start Infrastructure Services (PostgreSQL, Redis, MinIO, Mailpit, Nginx):**
   ```bash
   pnpm dev:infra
   ```

2. **Start the Applications:**
   ```bash
   pnpm dev
   ```

## Main Development Ports

The primary entrypoint during development is **http://localhost:7777**. The gateway internally routes requests:

- `Gateway`: 7777
- `Web`: 7778
- `Admin`: 7779
- `API`: 7780
- `Portal`: 7781
- `Worker`: 7782

*See [ADR-011](./docs/14-decisions/ADR-011-development-ports.md) for more details.*

## Testing

Vibress uses Playwright for End-to-End tests and Vitest for unit/integration testing.
```bash
pnpm test
```

## Security Note

**Never commit `.env` files or real secrets.** Use environment variables for all sensitive configuration (Database credentials, API keys, `VIBRESS_ENCRYPTION_KEY`). If you discover a vulnerability, please report it following responsible disclosure practices.

## Documentation Location

Comprehensive architecture documentation can be found in [`docs/README.md`](./docs/README.md).

## Production/Deployment Documentation

For production guidelines, scaling, and deployment, please refer to [`docs/12-infrastructure/production.md`](./docs/12-infrastructure/production.md).

## License

Vibress is distributed under the [MIT License](./LICENSE).
