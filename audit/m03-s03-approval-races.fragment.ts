
async function ag02Ag04WaitForLock(
  inspector: Client,
  pid: number,
  sqlMarker: string,
): Promise<void> {
  for (let n = 0; n < 55; n += 1) {
    const state = await inspector.query<{
      wait_event_type: string | null; query: string;
    }>(
      "SELECT wait_event_type, query FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (state.rows[0]?.wait_event_type === "Lock" &&
      state.rows[0]?.query.includes(sqlMarker)) return;
    await inspector.query("SELECT pg_sleep(0.015)");
  }
  throw Error("AG02_AG04_PG_LOCK_BARRIER_NOT_OBSERVED: " + sqlMarker);
}

async function ag02Ag04WaitForExpiry(inspector: Client, installationId: string): Promise<void> {
  for (let n = 0; n < 85; n += 1) {
    const state = await inspector.query<{ expired: boolean }>(
      "SELECT clock_timestamp() > expires_at AS expired " +
      "FROM public.platform_schema_approvals WHERE installation_id = $1",
      [installationId],
    );
    if (state.rows[0]?.expired) return;
    await inspector.query("SELECT pg_sleep(0.015)");
  }
  throw Error("AG02_AG04_DATABASE_APPROVAL_EXPIRY_NOT_OBSERVED");
}

describe("AG02_AG04_ADVERSARIAL integrated approval and table-lock races", () => {
  it("AG02_AG04_ADVERSARIAL revocation after authorization while target DDL lock waits commits strictly after operator", async () => {
    const lab = await createLab("i");
    labs.push(lab);
    await approve(lab);
    const seed = await contentChecksum(lab);
    const locker = await connect(lab.name);
    const revoker = await connect(lab.name, lab.approver);
    const operation = lab.plan.operations[0]?.id;
    let execution: Promise<unknown> | undefined;
    let revocation: Promise<unknown> | undefined;
    try {
      await locker.query("BEGIN");
      await locker.query(
        'LOCK TABLE ONLY "public".' + locker.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      );
      execution = run(lab);
      await ag02Ag04WaitForLock(lab.dbAdmin, lab.operator.processID ?? -1, "LOCK TABLE ONLY");
      revocation = revoker.query(
        "SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId, lab.plan.digest, operation],
      );
      await ag02Ag04WaitForLock(lab.dbAdmin, revoker.processID ?? -1,
        "platform_schema_revoke_operation");
      await locker.query("COMMIT");
      await expect(execution).resolves.toMatchObject({ status: "APPLIED" });
      await revocation;
      const evidence = await lab.dbAdmin.query<{ordered: boolean, journal_count: string}>(
        "SELECT (j.completed_at < a.revoked_at) AS ordered, " +
        "(SELECT count(*)::text FROM public.platform_schema_migration_journal) AS journal_count " +
        "FROM public.platform_schema_migration_journal j " +
        "JOIN public.platform_schema_revocation_audit a USING " +
        "(installation_id,plan_digest,operation_id)",
      );
      expect(evidence.rows).toEqual([{ordered:true,journal_count:"1"}]);
      expect(await hasWebsite(lab)).toBe(true);
      expect(await contentChecksum(lab)).toBe(seed);
      await expect(run(lab)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([execution ?? Promise.resolve(),revocation ?? Promise.resolve()]);
      await locker.end();
      await revoker.end();
    }
  }, 20000);

  it("AG02_AG04_ADVERSARIAL revocation wins before authorization advisory lock and denies DDL", async () => {
    const lab = await createLab("j");
    labs.push(lab);
    await approve(lab);
    const seed = await contentChecksum(lab);
    const revoker = await connect(lab.name, lab.approver);
    let execution: Promise<unknown> | undefined;
    try {
      await revoker.query("BEGIN");
      await revoker.query(
        "SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId, lab.plan.digest, lab.plan.operations[0]?.id],
      );
      execution = run(lab);
      await ag02Ag04WaitForLock(lab.dbAdmin, lab.operator.processID ?? -1,
        "vibress_m03s03_approval");
      await revoker.query("COMMIT");
      await expect(execution).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(seed);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal",
      )).rowCount).toBe(0);
    } finally {
      await revoker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([execution ?? Promise.resolve()]);
      await revoker.end();
    }
  }, 20000);

  it("AG02_AG04_ADVERSARIAL expired before approval lock acquisition is denied", async () => {
    const lab = await createLab("k");
    labs.push(lab);
    await approve(lab);
    const seed = await contentChecksum(lab);
    const blocker = await connect(lab.name);
    let execution: Promise<unknown> | undefined;
    try {
      // Seed expiry BEFORE holding the advisory lock: even a privileged
      // direct UPDATE routes through the 0060 approval trigger and must
      // acquire that same key. Reversing this order deadlocks the test itself.
      await lab.dbAdmin.query(
        "UPDATE public.platform_schema_approvals " +
        "SET expires_at = clock_timestamp() + interval '700 milliseconds' " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );
      await blocker.query("BEGIN");
      const key = lab.installationId + ":" + lab.plan.digest + ":" + lab.plan.operations[0]?.id;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('vibress_m03s03_approval'),hashtext($1::text))",
        [key],
      );
      execution = run(lab);
      await ag02Ag04WaitForLock(lab.dbAdmin, lab.operator.processID ?? -1,
        "vibress_m03s03_approval");
      await ag02Ag04WaitForExpiry(lab.dbAdmin, lab.installationId);
      await blocker.query("COMMIT");
      await expect(execution).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(await hasWebsite(lab)).toBe(false);
      expect(await contentChecksum(lab)).toBe(seed);
      expect((await lab.dbAdmin.query(
        "SELECT 1 FROM public.platform_schema_migration_journal",
      )).rowCount).toBe(0);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([execution ?? Promise.resolve()]);
      await blocker.end();
    }
  }, 18000);

  it("AG02_AG04_ADVERSARIAL expiry after validated authorization but during table lock is observed at commit", async () => {
    const lab = await createLab("l");
    labs.push(lab);
    await approve(lab);
    const seed = await contentChecksum(lab);
    const blocker = await connect(lab.name);
    let execution: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        'LOCK TABLE ONLY "public".' + blocker.escapeIdentifier(lab.table) +
        " IN ACCESS EXCLUSIVE MODE",
      );
      await lab.dbAdmin.query(
        "UPDATE public.platform_schema_approvals " +
        "SET expires_at = clock_timestamp() + interval '750 milliseconds' " +
        "WHERE installation_id = $1",
        [lab.installationId],
      );
      execution = run(lab);
      await ag02Ag04WaitForLock(lab.dbAdmin, lab.operator.processID ?? -1, "LOCK TABLE ONLY");
      await ag02Ag04WaitForExpiry(lab.dbAdmin, lab.installationId);
      await blocker.query("COMMIT");
      // Observational contract: approval was valid when the exclusive
      // advisory authorization lock was acquired. Whether expiry at COMMIT
      // must override that linearization is an independent policy decision.
      // This assertion records the current actual behavior, not release approval.
      await expect(execution).resolves.toMatchObject({ status: "APPLIED" });
      const snapshot = await lab.dbAdmin.query<{ expired_at_commit: boolean }>(
        "SELECT j.completed_at > a.expires_at AS expired_at_commit " +
        "FROM public.platform_schema_migration_journal j " +
        "JOIN public.platform_schema_approvals a USING " +
        "(installation_id,plan_digest,operation_id)",
      );
      expect(snapshot.rows[0]?.expired_at_commit).toBe(true);
      expect(await hasWebsite(lab)).toBe(true);
      expect(await contentChecksum(lab)).toBe(seed);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([execution ?? Promise.resolve()]);
      await blocker.end();
    }
  }, 18000);

  it("AG02_AG04_ADVERSARIAL revocation during post-DDL pre-COMMIT barrier cannot invalidate a previously linearized migration", async () => {
    const lab = await createLab("m");
    labs.push(lab);
    await approve(lab);
    const seed = await contentChecksum(lab);
    const revoker = await connect(lab.name,lab.approver);
    let signal!: () => void;
    let release!: () => void;
    const inserted = new Promise<void>(resolve => { signal = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const adapter = {
      escapeIdentifier: lab.operator.escapeIdentifier.bind(lab.operator),
      query: async (sql: string,params?: unknown[]) => {
        const result = await lab.operator.query(sql,params);
        if (sql.startsWith("INSERT INTO public.platform_schema_migration_journal")) {
          signal();
          await gate;
        }
        return result;
      },
    } as unknown as ClientBase;
    const execution = executeApprovedAdditiveColumn(adapter, {
      installationId: lab.installationId, planDigest: lab.plan.digest,
    });
    let revocation: Promise<unknown> | undefined;
    try {
      await Promise.race([
        inserted,
        new Promise<never>((_,reject) => setTimeout(
          () => reject(Error("AG02_AG04_JOURNAL_BARRIER_NOT_REACHED")),5000)),
      ]);
      revocation = revoker.query(
        "SELECT public.platform_schema_revoke_operation($1,$2,$3)",
        [lab.installationId,lab.plan.digest,lab.plan.operations[0]?.id],
      );
      await ag02Ag04WaitForLock(lab.dbAdmin, revoker.processID ?? -1,
        "platform_schema_revoke_operation");
      release();
      await expect(execution).resolves.toMatchObject({ status: "APPLIED" });
      await revocation;
      const result = await lab.dbAdmin.query<{commit_precedes_revocation:boolean}>(
        "SELECT j.completed_at < a.revoked_at AS commit_precedes_revocation " +
        "FROM public.platform_schema_migration_journal j " +
        "JOIN public.platform_schema_revocation_audit a USING " +
        "(installation_id,plan_digest,operation_id)",
      );
      expect(result.rows).toEqual([{commit_precedes_revocation:true}]);
      expect(await hasWebsite(lab)).toBe(true);
      expect(await contentChecksum(lab)).toBe(seed);
      await expect(run(lab)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    } finally {
      release();
      await Promise.allSettled([execution,revocation ?? Promise.resolve()]);
      await revoker.end();
    }
  }, 20000);
});
