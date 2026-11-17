

/**
 * Agent 02 independently authored test-only observer. The production operator,
 * approval migration and canonical fixtures are untouched.
 */
async function ag02WaitForPgLock(
  inspector: Client, pid: number, sqlFragment: string,
): Promise<void> {
  for (let attempts = 0; attempts < 160; attempts += 1) {
    const state = await inspector.query<{ wait_event_type: string | null; query: string }>(
      "SELECT wait_event_type, query FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (state.rows[0]?.wait_event_type === "Lock" &&
      state.rows[0]?.query.includes(sqlFragment)) return;
    await inspector.query("SELECT pg_sleep(0.01)");
  }
  throw Error("AG02_S03_08_EXPECTED_PG_LOCK_WAIT_NOT_OBSERVED");
}

describe("AG02-S03-08 separately authored PostgreSQL 16 lock and time evidence", () => {
  it("AG02_S03_08_DEADLOCK two-session external DDL versus operator registry row aborts a victim without journal corruption", async () => {
    const lab = await createLab("o");
    labs.push(lab);
    await approve(lab);
    const checksum = await contentChecksum(lab);
    const external = await connect(lab.name);
    const sqlStates: string[] = [];
    let observedOperator = false;
    let operatorResult:
      | { kind: "FULFILLED"; status: string }
      | { kind: "REJECTED"; code: string | undefined } | undefined;
    try {
      await external.query("BEGIN");
      // The external session is disposable superuser and can set this only
      // locally. It initiates deadlock detection well inside the operator's
      // bounded 2-second lock wait.
      await external.query("SET LOCAL deadlock_timeout = '100ms'");
      await external.query("SET LOCAL statement_timeout = '4500ms'");
      await external.query(
        'LOCK TABLE ONLY "public".' + external.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      );
      const tracedOperator = {
        escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
        query: async (sql: string, params?: unknown[]) => {
          try {
            if (params === undefined) return await lab.operator.query(sql);
            return await lab.operator.query(sql, params);
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (typeof code === "string") sqlStates.push(code);
            throw error;
          }
        },
      } as unknown as ClientBase;
      const running = executeApprovedAdditiveColumn(tracedOperator, {
        installationId: lab.installationId,
        planDigest: lab.plan.digest,
      }).then(
        result => ({ kind: "FULFILLED" as const, status: result.status }),
        error => ({ kind: "REJECTED" as const, code: (error as { code?: string }).code }),
      );
      await ag02WaitForPgLock(
        lab.dbAdmin, lab.operator.processID ?? -1, "LOCK TABLE ONLY",
      );
      observedOperator = true;
      let externalCode: string | undefined;
      try {
        // External DDL holds the table lock while operator holds registry
        // FOR UPDATE and awaits the table: a true lock-cycle probe.
        await external.query(
          "SELECT installation_id FROM public.platform_schema_registry " +
          "WHERE installation_id = $1 FOR SHARE",
          [lab.installationId],
        );
      } catch (error) {
        externalCode = (error as { code?: string }).code;
      } finally {
        await external.query("ROLLBACK").catch(() => undefined);
      }
      operatorResult = await running;
      expect(
        externalCode === "40P01" || sqlStates.includes("40P01"),
        "PostgreSQL must identify an actual deadlock; timeout-only is inadequate",
      ).toBe(true);
      const data = await lab.dbAdmin.query<{
        count: string; digest: string | null;
      }>(
        "SELECT count(j.operation_id)::text AS count, max(r.manifest_digest) AS digest " +
        "FROM public.platform_schema_registry r " +
        "LEFT JOIN public.platform_schema_migration_journal j " +
        "ON j.installation_id = r.installation_id " +
        "WHERE r.installation_id = $1",
        [lab.installationId],
      );
      expect(data.rows).toHaveLength(1);
      if (operatorResult.kind === "FULFILLED") {
        // PostgreSQL chose the *external* transaction as deadlock victim.
        // With the outsider's transaction rolled back, an authorized
        // operator is allowed to finish exactly once.
        expect(operatorResult.status).toBe("APPLIED");
        expect(data.rows[0]).toEqual({
          count: "1", digest: lab.plan.proposedManifest.digest,
        });
        expect(await hasWebsite(lab)).toBe(true);
        expect((await run(lab)).status).toBe("ALREADY_APPLIED");
      } else {
        // PostgreSQL chose the *operator* as victim: no mixed state.
        expect(operatorResult.code).toBe("UNAUTHORIZED");
        expect(data.rows[0]).toEqual({ count: "0", digest: lab.current.digest });
        expect(await hasWebsite(lab)).toBe(false);
      }
      expect(await contentChecksum(lab)).toBe(checksum);
    } finally {
      await external.query("ROLLBACK").catch(() => undefined);
      await external.end().catch(() => undefined);
    }
    expect(observedOperator).toBe(true);
    expect(operatorResult).toBeDefined();
  }, 15000);

  it("AG02_S03_08_TIME database clock advances across lock wait, transaction clock does not", async () => {
    const lab = await createLab("p");
    labs.push(lab);
    await approve(lab);
    const waiter = await connect(lab.name, lab.operatorRole);
    const blocker = await connect(lab.name);
    try {
      const key = "s03_pg_time_probe_" + lab.installationId;
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [key]);
      await waiter.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const initial = (await waiter.query<{
        tx: Date; st: Date; wall: Date;
      }>(
        "SELECT transaction_timestamp() AS tx, statement_timestamp() AS st, " +
        "clock_timestamp() AS wall",
      )).rows[0]!;
      const blocked = waiter.query(
        "SELECT pg_advisory_xact_lock(hashtext($1::text))", [key],
      );
      await ag02WaitForPgLock(
        lab.dbAdmin, waiter.processID ?? -1, "pg_advisory_xact_lock",
      );
      const seen = await lab.dbAdmin.query<{ observed: Date }>(
        "SELECT clock_timestamp() AS observed",
      );
      await blocker.query("COMMIT");
      await blocked;
      const final = (await waiter.query<{ tx: Date; st: Date; wall: Date }>(
        "SELECT transaction_timestamp() AS tx, statement_timestamp() AS st, " +
        "clock_timestamp() AS wall",
      )).rows[0]!;
      expect(final.tx.getTime()).toBe(initial.tx.getTime());
      expect(final.st.getTime()).toBeGreaterThan(initial.st.getTime());
      expect(final.wall.getTime()).toBeGreaterThanOrEqual(seen.rows[0]!.observed.getTime());
      expect(final.wall.getTime()).toBeGreaterThan(initial.wall.getTime());
      await waiter.query("COMMIT");
    } finally {
      await waiter.query("ROLLBACK").catch(() => undefined);
      await blocker.query("ROLLBACK").catch(() => undefined);
      await waiter.end().catch(() => undefined);
      await blocker.end().catch(() => undefined);
    }
  }, 12000);
});
