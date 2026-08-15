import {
  getDb,
  automations,
  AutomationRow,
  automationVersions,
  AutomationVersionRow,
  automationRuns,
  AutomationRunRow,
  automationRunSteps,
  AutomationRunStepRow,
} from "@vibress/database";
import { eq, and, count, desc, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { AutomationRepository } from "../domain/repository";
import {
  Automation,
  AutomationVersion,
  AutomationRun,
  AutomationRunStep,
  AutomationDefinition,
  CreateAutomationData,
  AutomationStatus,
} from "../domain/automation";

export class DrizzleAutomationRepository implements AutomationRepository {
  async create(data: CreateAutomationData): Promise<Automation> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(automations)
      .values({
        id: data.id || crypto.randomUUID(),
        key: data.key,
        name: data.name,
        description: data.description || null,
        triggerEvent: data.triggerEvent,
        conditions: data.conditions || [],
        actions: data.actions || [],
        status: data.status || "draft",
        version: 1,
        createdBy: data.createdBy || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert automation");
    return this.mapAutomationToDomain(row);
  }

  async findById(id: string): Promise<Automation | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automations)
      .where(eq(automations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapAutomationToDomain(row);
  }

  async findByKey(key: string): Promise<Automation | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automations)
      .where(eq(automations.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapAutomationToDomain(row);
  }

  async update(
    id: string,
    data: Partial<CreateAutomationData>,
  ): Promise<Automation> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description;
    if (data.triggerEvent !== undefined)
      payload.triggerEvent = data.triggerEvent;
    if (data.conditions !== undefined) payload.conditions = data.conditions;
    if (data.actions !== undefined) payload.actions = data.actions;
    if (data.status !== undefined) payload.status = data.status;
    const [row] = await db
      .update(automations)
      .set(payload)
      .where(eq(automations.id, id))
      .returning();
    if (!row) throw new Error(`Automation not found: ${id}`);
    return this.mapAutomationToDomain(row);
  }

  async updateStatus(
    id: string,
    status: AutomationStatus,
  ): Promise<Automation> {
    const db = getDb();
    const [row] = await db
      .update(automations)
      .set({ status, updatedAt: new Date() })
      .where(eq(automations.id, id))
      .returning();
    if (!row) throw new Error(`Automation not found: ${id}`);
    return this.mapAutomationToDomain(row);
  }

  async list(): Promise<Automation[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automations)
      .orderBy(automations.createdAt);
    return rows.map((r) => this.mapAutomationToDomain(r));
  }

  async listActiveByTrigger(triggerEvent: string): Promise<Automation[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.status, "active"),
          eq(automations.triggerEvent, triggerEvent),
        ),
      );
    return rows.map((r) => this.mapAutomationToDomain(r));
  }

  async createVersion(
    automationId: string,
    version: number,
    definition: AutomationDefinition,
  ): Promise<AutomationVersion> {
    const db = getDb();
    const [row] = await db
      .insert(automationVersions)
      .values({
        id: crypto.randomUUID(),
        automationId,
        version,
        definition: definition as unknown as Record<string, unknown>,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert automation version");
    return this.mapVersionToDomain(row);
  }

  async getVersion(
    automationId: string,
    version: number,
  ): Promise<AutomationVersion | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationVersions)
      .where(
        and(
          eq(automationVersions.automationId, automationId),
          eq(automationVersions.version, version),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapVersionToDomain(row);
  }

  async createRun(data: {
    automationId: string;
    version: number;
    runKey: string;
    triggerEvent: string;
    eventPayload: Record<string, unknown> | null;
    depth: number;
    correlationId: string | null;
  }): Promise<AutomationRun> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(automationRuns)
      .values({
        id: crypto.randomUUID(),
        automationId: data.automationId,
        version: data.version,
        runKey: data.runKey,
        triggerEvent: data.triggerEvent,
        eventPayload: data.eventPayload,
        status: "pending",
        depth: data.depth,
        correlationId: data.correlationId,
        startedAt: now,
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert automation run");
    return this.mapRunToDomain(row);
  }

  async findRun(
    automationId: string,
    runKey: string,
  ): Promise<AutomationRun | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, automationId),
          eq(automationRuns.runKey, runKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapRunToDomain(row);
  }

  async findRunById(id: string): Promise<AutomationRun | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapRunToDomain(row);
  }

  async listRuns(
    filter: {
      automationId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ runs: AutomationRun[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;
    const conditions = [];
    if (filter.automationId)
      conditions.push(eq(automationRuns.automationId, filter.automationId));
    if (filter.status)
      conditions.push(eq(automationRuns.status, filter.status));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const countRes = await db
      .select({ total: count() })
      .from(automationRuns)
      .where(whereClause);
    const rows = await db
      .select()
      .from(automationRuns)
      .where(whereClause)
      .orderBy(desc(automationRuns.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      runs: rows.map((r) => this.mapRunToDomain(r)),
      total: Number(countRes[0]?.total || 0),
    };
  }

  async updateRunStatus(
    id: string,
    status: string,
    patch?: Partial<AutomationRun>,
  ): Promise<void> {
    const db = getDb();
    const payload: Record<string, unknown> = { status };
    if (patch?.completedAt !== undefined)
      payload.completedAt = patch.completedAt;
    if (patch?.error !== undefined) payload.error = patch.error;
    await db
      .update(automationRuns)
      .set(payload)
      .where(eq(automationRuns.id, id));
  }

  async incrementRunDepth(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(automationRuns)
      .set({ depth: sql`${automationRuns.depth} + 1` })
      .where(eq(automationRuns.id, id));
  }

  async createStep(data: {
    runId: string;
    stepIndex: number;
    actionType: string;
  }): Promise<AutomationRunStep> {
    const db = getDb();
    const [row] = await db
      .insert(automationRunSteps)
      .values({
        id: crypto.randomUUID(),
        runId: data.runId,
        stepIndex: data.stepIndex,
        actionType: data.actionType,
        status: "pending",
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert automation run step");
    return this.mapStepToDomain(row);
  }

  async findStep(
    runId: string,
    stepIndex: number,
  ): Promise<AutomationRunStep | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationRunSteps)
      .where(
        and(
          eq(automationRunSteps.runId, runId),
          eq(automationRunSteps.stepIndex, stepIndex),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapStepToDomain(row);
  }

  async updateStepStatus(
    id: string,
    status: string,
    patch?: Partial<AutomationRunStep>,
  ): Promise<void> {
    const db = getDb();
    const payload: Record<string, unknown> = { status };
    if (patch?.result !== undefined) payload.result = patch.result;
    if (patch?.error !== undefined) payload.error = patch.error;
    if (patch?.attempts !== undefined) payload.attempts = patch.attempts;
    if (patch?.executedAt !== undefined) payload.executedAt = patch.executedAt;
    await db
      .update(automationRunSteps)
      .set(payload)
      .where(eq(automationRunSteps.id, id));
  }

  async listSteps(runId: string): Promise<AutomationRunStep[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationRunSteps)
      .where(eq(automationRunSteps.runId, runId))
      .orderBy(automationRunSteps.stepIndex);
    return rows.map((r) => this.mapStepToDomain(r));
  }

  async findWaitingRuns(limit: number): Promise<AutomationRun[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.status, "waiting"))
      .orderBy(automationRuns.createdAt)
      .limit(limit);
    return rows.map((r) => this.mapRunToDomain(r));
  }

  async findWaitingSteps(limit: number): Promise<AutomationRunStep[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(automationRunSteps)
      .where(eq(automationRunSteps.status, "waiting"))
      .orderBy(automationRunSteps.createdAt)
      .limit(limit);
    return rows.map((r) => this.mapStepToDomain(r));
  }

  private mapAutomationToDomain(row: AutomationRow): Automation {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description || null,
      triggerEvent: row.triggerEvent,
      conditions: row.conditions as Automation["conditions"],
      actions: row.actions as Automation["actions"],
      status: row.status as AutomationStatus,
      version: row.version,
      createdBy: row.createdBy || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapVersionToDomain(row: AutomationVersionRow): AutomationVersion {
    return {
      id: row.id,
      automationId: row.automationId,
      version: row.version,
      definition: row.definition as AutomationVersion["definition"],
      createdAt: row.createdAt,
    };
  }

  private mapRunToDomain(row: AutomationRunRow): AutomationRun {
    return {
      id: row.id,
      automationId: row.automationId,
      version: row.version,
      runKey: row.runKey,
      triggerEvent: row.triggerEvent,
      eventPayload: row.eventPayload as Record<string, unknown> | null,
      status: row.status as AutomationRun["status"],
      depth: row.depth,
      correlationId: row.correlationId || null,
      error: row.error || null,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }

  private mapStepToDomain(row: AutomationRunStepRow): AutomationRunStep {
    return {
      id: row.id,
      runId: row.runId,
      stepIndex: row.stepIndex,
      actionType: row.actionType,
      status: row.status as AutomationRunStep["status"],
      result: row.result as Record<string, unknown> | null,
      error: row.error || null,
      attempts: row.attempts,
      executedAt: row.executedAt,
      createdAt: row.createdAt,
    };
  }
}
