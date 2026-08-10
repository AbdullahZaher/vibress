# Backup & Restore

A normal application export is NOT a disaster-recovery backup.

A real Vibress backup must include:

1. **PostgreSQL** — full database dump (schema + data + migration journal).
2. **Object/local storage** — media assets and any export artifacts.
3. **VIBRESS_ENCRYPTION_KEY** — secured separately (secrets are encrypted
   at rest with this key; without it, encrypted secrets are unrecoverable).
4. **Deployment configuration** — env vars, Docker/process definitions.
5. **Plugin code/config** — bundled plugin sources when applicable.

## Restore Expectations

Restore = restore PostgreSQL, restore storage, restore the encryption key,
restore config/plugins, then run migrations. Imported application exports
are portable data only and are never a substitute for this procedure.
