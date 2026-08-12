# Vibress

Vibress is a modern, open-source Content Management System (CMS) designed as a
fast, self-hosted alternative to other CMS platforms.

The name **Vibress** comes from:

- **Vibe**: Inspired by vibe-coding, representing the idea of building software
  quickly with creativity and modern AI-assisted development.
- **Press**: Represents publishing and content management platforms.

Vibress aims to provide a fast, modern CMS experience that developers can
self-host easily on their own servers, giving you full control over your content
and platform.

## Features Overview

- **Modern CMS Architecture**: Built for speed and flexibility with an API-first
  design.
- **Content Management**: Intuitive tools for writing and managing your posts
  and media.
- **Admin Dashboard**: A sleek and responsive interface to manage your site.
- **Publishing Workflow**: Robust tools for scheduling and publishing content.
- **Authentication & Security**: Secure role-based access control and member
  management.
- **Background Workers & Jobs**: Reliable background processing for emails,
  notifications, and scheduled tasks.
- **Observability**: Production-ready logging and metrics capabilities.

## Technology Stack

Vibress uses a modern, full-stack JavaScript/TypeScript ecosystem:

- **Frontend Applications**:
  - **React/Vite** for the Admin Dashboard and Portal, providing a fast Single
    Page Application experience.
  - **Next.js** for the public-facing Web application, optimizing for SEO and
    performance.
- **Backend API**: Powered by **Fastify**, ensuring high-performance API
  endpoints.
- **Database**: **PostgreSQL** with **Drizzle ORM** for reliable and type-safe
  data persistence.
- **Cache & Queue**: **Redis** (via BullMQ) for fast caching and robust
  background job processing.
- **Containerization**: **Docker & Docker Compose** for easy deployment and
  consistent environments.

## Quick Start Guide

### Option A: Run with Docker (Recommended)

**Requirements**:

- Docker
- Docker Compose

1. **Clone the repository**:
   ```bash
   git clone https://github.com/vibress/vibress.git
   cd vibress
   ```

2. **Copy environment example files**:
   ```bash
   cp .env.example .env
   ```

3. **Configure required variables**: Open `.env` and fill in any required
   secrets (the defaults work well for local development).

4. **Start the project infrastructure**:
   ```bash
   # Start Postgres, Redis, Minio, Mailpit
   pnpm dev:infra
   ```

5. **Start the development servers**:
   ```bash
   # Start the API, Worker, Web, Admin, and Portal applications
   pnpm dev
   ```

6. **Access URLs**:
   - Website: http://localhost:7778
   - Admin Dashboard: http://localhost:7779/admin/ (development) or
     http://localhost:8080/admin/ (production build)
   - API: http://localhost:7780

7. **First-run setup**: On a fresh database, open the Admin Dashboard and the
   First-Run Setup Wizard appears. Enter the setup key (in development, the
   API prints a one-time ephemeral token to its console if `VIBRESS_SETUP_TOKEN`
   is unset), then configure your site and create the owner account. After
   installation the wizard is permanently locked.

   Production: generate a secret and set it before starting —
   ```bash
   openssl rand -hex 32   # → set VIBRESS_SETUP_TOKEN=<value> in .env
   ```

_(To stop the infrastructure, run `pnpm dev:infra:down`)_

### Option B: Run locally without Docker

If you prefer to run the infrastructure yourself:

1. **Required versions**:
   - Node.js (>= 24.0.0)
   - pnpm (>= 11.17.0)
   - PostgreSQL (16+)
   - Redis (7+)

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Database setup**: Ensure PostgreSQL is running and update your `.env` with
   the correct `DATABASE_URL`.
   ```bash
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   ```

4. **Run development servers**:
   ```bash
   pnpm dev
   ```

## VPS Deployment Guide

Deploying Vibress to a Virtual Private Server (VPS) is straightforward using
Docker.

**Prerequisites**:

- An Ubuntu VPS.
- A Domain name pointed to your VPS IP.
- Docker and Docker Compose installed.

1. **Connect to your VPS**:
   ```bash
   ssh user@your-vps-ip
   ```

2. **Clone Vibress**:
   ```bash
   git clone https://github.com/vibress/vibress.git
   cd vibress
   ```

3. **Configure environment**:
   ```bash
   cp infrastructure/env.prod.example .env
   # Edit .env with your domain, secure passwords, and secrets
   nano .env
   ```

4. **Start containers**:
   ```bash
   pnpm prod:up
   ```

5. **Configure domain/reverse proxy**: Set up a reverse proxy like Nginx or
   Caddy on your host machine to route traffic from your domain to the Vibress
   gateway port.

6. **Verify deployment**: Run database migrations if needed:
   ```bash
   pnpm prod:migrate
   ```
   Visit your domain to confirm the site is live.

## Production Deployment Best Practices

When running Vibress in production, keep the following in mind:

- **Environment Variables**: Never commit `.env.prod` or expose your secret
  keys. Always use strong, randomly generated secrets.
- **Database Backups**: Set up automated backups for your PostgreSQL database
  and Minio (or S3) storage.
- **HTTPS**: Always serve your site over HTTPS. Use Let's Encrypt with your
  reverse proxy (e.g., Caddy or Nginx).
- **Monitoring**: Utilize the built-in observability features. Monitor logs and
  configure alerts for your containers.
- **Updating**: To update safely, pull the latest changes, rebuild the images,
  and apply migrations:
  ```bash
  git pull
  pnpm prod:up
  pnpm prod:migrate
  ```

## Project Structure

Vibress is structured as a monorepo. Here are the key directories you should
know:

- `apps/`: Contains the main applications (`api`, `worker`, `web`, `admin`,
  `portal`).
- `packages/`: Shared libraries, database schemas, and utilities used across the
  apps.
- `docker/`: Dockerfiles for building the various services.
- `scripts/`: Utility scripts for bootstrapping and development tasks.

## Contributing

We welcome contributions!

- **How to contribute**: Fork the repository, create a feature branch, and
  submit a Pull Request.
- **Reporting Issues**: Use the GitHub Issues tab to report bugs or request
  features.
- **Development Workflow**: Follow the Quick Start guide to run the project
  locally. Ensure you run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before
  submitting changes.

## License and Community

- **License**: MIT License (see `LICENSE` file).
- **Community**: Join our community discussions on GitHub!
