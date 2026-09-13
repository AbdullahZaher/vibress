# Vibress Troubleshooting Guide

This guide provides diagnosis and resolution procedures for common operational issues encountered in production or self-hosted deployments.

---

## 1. Gateway Returns 502 Bad Gateway

### Symptoms
Accessing `http://yourdomain.com/` returns `502 Bad Gateway` from NGINX.

### Diagnosis
The NGINX reverse proxy cannot reach one of the upstream application containers (`api:7780`, `web:7778`, `admin:8080`, or `portal:8080`).

### Resolution
1. Check running container status:
   ```bash
   docker compose -f compose.prod.yml ps
   ```
2. Inspect API and Web container logs:
   ```bash
   docker compose -f compose.prod.yml logs api
   docker compose -f compose.prod.yml logs web
   ```
3. Look for configuration errors (e.g. missing `POSTGRES_PASSWORD` or `VIBRESS_ENCRYPTION_KEY`).

---

## 2. API Readiness Probe Fails (`/health/ready` Returns 503)

### Symptoms
The API starts but returns HTTP 503 on `/health/ready`.

### Diagnosis
The API process cannot establish or maintain a connection to PostgreSQL or Redis.

### Resolution
1. Check if PostgreSQL is healthy:
   ```bash
   docker compose -f compose.prod.yml exec postgres pg_isready -U vibress -d vibress
   ```
2. Check if Redis is accepting connections:
   ```bash
   docker compose -f compose.prod.yml exec redis redis-cli ping
   ```
3. Verify `DATABASE_URL` and `REDIS_URL` in `.env`.

---

## 3. Worker Outbox Queue Stalled / Delayed Publishing

### Symptoms
Scheduled posts are not publishing automatically, or email events are not being sent.

### Diagnosis
The `@vibress/worker` container is halted, out of memory, or experiencing Redis connection timeouts.

### Resolution
1. Inspect worker health:
   ```bash
   curl -f http://localhost:7777/worker-health/ready
   ```
2. Check worker logs:
   ```bash
   docker compose -f compose.prod.yml logs -f worker
   ```
3. Restart the worker service:
   ```bash
   docker compose -f compose.prod.yml restart worker
   ```

---

## 4. CORS Errors on Admin or Portal SPA

### Symptoms
Browser console shows `Access-Control-Allow-Origin` errors when making API calls from Admin or Portal.

### Diagnosis
In `NODE_ENV=production`, CORS origins are strictly enforced. The request origin does not match `ADMIN_ORIGIN`, `PORTAL_ORIGIN`, or `CORS_ORIGINS`.

### Resolution
1. Check `.env` configuration:
   ```dotenv
   SITE_URL=https://yourdomain.com
   ADMIN_ORIGIN=https://yourdomain.com
   PORTAL_ORIGIN=https://yourdomain.com
   ```
2. Ensure origins include the scheme (`https://`) and omit trailing slashes.
3. Restart the API:
   ```bash
   docker compose -f compose.prod.yml restart api
   ```

---

## 5. Stripe Webhooks Returning 400 Bad Request

### Symptoms
Stripe dashboard reports failing webhook deliveries with status 400.

### Diagnosis
The `STRIPE_WEBHOOK_SECRET` in `.env` does not match the signing secret configured in your Stripe Developer Dashboard.

### Resolution
1. Verify the webhook secret in Stripe Dashboard (`Developers > Webhooks > Signing secret`).
2. Update `STRIPE_WEBHOOK_SECRET=whsec_...` in `.env`.
3. Restart the API:
   ```bash
   docker compose -f compose.prod.yml restart api
   ```

---

## 6. Disk Space Exhaustion on Docker Host

### Symptoms
Database operations fail with `disk full` or `no space left on device`.

### Diagnosis
Docker log files or unpruned build caches have consumed host disk space.

### Resolution
1. Check disk utilization:
   ```bash
   df -h
   ```
2. Clean unused Docker artifacts:
   ```bash
   docker system prune -a --volumes
   ```
3. Verify automated log rotation is configured in Docker daemon `/etc/docker/daemon.json`:
   ```json
   {
     "log-driver": "json-file",
     "log-opts": {
       "max-size": "50m",
       "max-file": "3"
     }
   }
   ```
