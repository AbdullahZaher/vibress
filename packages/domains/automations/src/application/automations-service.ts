import { AutomationRepository } from '../domain/repository';
import {
  Automation, AutomationCondition, AutomationAction, AutomationDefinition, AutomationRun, CreateAutomationData,
  ALLOWED_TRIGGERS, AutomationStatus,
} from '../domain/automation';
import { domainEvents } from '@vibress/events';

export class AutomationDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_AUTOMATION_DEPTH = 5;
export const MAX_ACTIONS = 10;

export interface AutomationDispatcher {
  enqueueRun(runId: string): Promise<void>;
  enqueueDelayedStep(runId: string, stepIndex: number, delayMs: number): Promise<void>;
}

export interface AutomationActionExecutor {
  execute(action: AutomationAction, context: { runId: string; stepIndex: number; memberId?: string | null; eventPayload: Record<string, unknown> | null }): Promise<{ result: Record<string, unknown>; delayMs?: number }>;
}

/**
 * Safe declarative condition evaluator. Data-only — no eval, no arbitrary
 * JavaScript. Field paths are dotted paths resolved from the event payload
 * (e.g. "subscription.status").
 */
export function evaluateConditions(conditions: AutomationCondition[], payload: Record<string, unknown> | null): boolean {
  if (!conditions || conditions.length === 0) return true;
  const data = payload || {};
  for (const condition of conditions) {
    const value = resolveField(data, condition.field);
    switch (condition.op) {
      case 'equals':
        if (value !== condition.value) return false;
        break;
      case 'not_equals':
        if (value === condition.value) return false;
        break;
      case 'exists':
        if (value === undefined || value === null) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

function resolveField(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export class AutomationsService {
  constructor(
    private repo: AutomationRepository,
    private dispatcher: AutomationDispatcher,
    private executor: AutomationActionExecutor
  ) {}

  // ---------------- CRUD ----------------

  async createAutomation(data: CreateAutomationData, actorId: string | null): Promise<Automation> {
    if (!ALLOWED_TRIGGERS.includes(data.triggerEvent as any)) {
      throw new AutomationDomainError('INVALID_TRIGGER', `Trigger ${data.triggerEvent} is not allowed`);
    }
    if (!data.name.trim()) throw new AutomationDomainError('VALIDATION_ERROR', 'Name is required');
    if ((data.actions || []).length > MAX_ACTIONS) {
      throw new AutomationDomainError('VALIDATION_ERROR', `At most ${MAX_ACTIONS} actions are allowed`);
    }
    const existing = await this.repo.findByKey(data.key);
    if (existing) throw new AutomationDomainError('VALIDATION_ERROR', 'Automation key already exists');

    const automation = await this.repo.create({ ...data, createdBy: actorId || undefined });
    // Immutable v1 definition snapshot
    await this.repo.createVersion(automation.id, 1, {
      conditions: data.conditions || [],
      actions: data.actions || [],
    });
    domainEvents.emit('automation.created', { automationId: automation.id, actorId });
    return automation;
  }

  async updateAutomation(id: string, data: Partial<CreateAutomationData>, actorId: string | null): Promise<Automation> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new AutomationDomainError('AUTOMATION_NOT_FOUND', 'Automation not found');
    if (data.triggerEvent && !ALLOWED_TRIGGERS.includes(data.triggerEvent as any)) {
      throw new AutomationDomainError('INVALID_TRIGGER', `Trigger ${data.triggerEvent} is not allowed`);
    }

    // Editing an active automation: snapshot a new immutable version
    const updated = await this.repo.update(id, data);
    if (data.conditions !== undefined || data.actions !== undefined) {
      const newVersion = updated.version + 1;
      await this.repo.update(id, { version: newVersion } as Partial<CreateAutomationData>);
      await this.repo.createVersion(id, newVersion, {
        conditions: data.conditions !== undefined ? data.conditions : existing.conditions,
        actions: data.actions !== undefined ? data.actions : existing.actions,
      });
    }
    domainEvents.emit('automation.updated', { automationId: id, actorId });
    return updated;
  }

  async activateAutomation(id: string, actorId: string | null): Promise<Automation> {
    const automation = await this.repo.findById(id);
    if (!automation) throw new AutomationDomainError('AUTOMATION_NOT_FOUND', 'Automation not found');
    if (automation.actions.length === 0) {
      throw new AutomationDomainError('VALIDATION_ERROR', 'Cannot activate an automation with no actions');
    }
    const activated = await this.repo.updateStatus(id, 'active');
    domainEvents.emit('automation.activated', { automationId: id, actorId });
    return activated;
  }

  async deactivateAutomation(id: string, actorId: string | null): Promise<Automation> {
    const automation = await this.repo.findById(id);
    if (!automation) throw new AutomationDomainError('AUTOMATION_NOT_FOUND', 'Automation not found');
    const deactivated = await this.repo.updateStatus(id, 'inactive');
    domainEvents.emit('automation.deactivated', { automationId: id, actorId });
    return deactivated;
  }

  async listAutomations(): Promise<Automation[]> {
    return this.repo.list();
  }

  async getAutomation(id: string): Promise<Automation | null> {
    return this.repo.findById(id);
  }

  // ---------------- Runs ----------------

  /**
   * Matches a domain event against active automations and creates runs.
   * Loop prevention: automation-generated runs carry a correlation chain;
   * depth is capped and automation-originated events do not re-trigger
   * the same automation.
   */
  async handleEvent(triggerEvent: string, payload: Record<string, unknown> | null, opts?: { correlationId?: string | null; depth?: number }): Promise<number> {
    const automations = await this.repo.listActiveByTrigger(triggerEvent);
    if (automations.length === 0) return 0;

    let created = 0;
    for (const automation of automations) {
      const depth = opts?.depth || 0;
      if (depth >= MAX_AUTOMATION_DEPTH) continue;

      // Conditions are evaluated against the event payload
      if (!evaluateConditions(automation.conditions, payload)) continue;

      // Idempotent run identity: automation + event identity
      const eventId = payload?.eventId ? String(payload.eventId) : undefined;
      const runKey = eventId ? `${triggerEvent}:${eventId}` : `${triggerEvent}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const existing = await this.repo.findRun(automation.id, runKey);
      if (existing) continue;

      // Self-generated event policy: if this event came from the same automation, skip
      const originAutomationId = payload?.originAutomationId;
      if (originAutomationId === automation.id) continue;

      const run = await this.repo.createRun({
        automationId: automation.id,
        version: automation.version,
        runKey,
        triggerEvent,
        eventPayload: payload,
        depth,
        correlationId: opts?.correlationId || null,
      });
      await this.dispatcher.enqueueRun(run.id);
      created++;
    }
    return created;
  }

  async manualRun(automationId: string, actorId: string | null): Promise<AutomationRun> {
    const automation = await this.repo.findById(automationId);
    if (!automation) throw new AutomationDomainError('AUTOMATION_NOT_FOUND', 'Automation not found');
    if (automation.status !== 'active') {
      throw new AutomationDomainError('AUTOMATION_NOT_ACTIVE', 'Automation is not active');
    }
    const run = await this.repo.createRun({
      automationId: automation.id,
      version: automation.version,
      runKey: `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      triggerEvent: 'manual',
      eventPayload: { actorId },
      depth: 0,
      correlationId: null,
    });
    await this.dispatcher.enqueueRun(run.id);
    return run;
  }

  /**
   * Executes a run's steps sequentially. Wait steps persist state and are
   * resumed via delayed queue jobs (durable across restarts).
   */
  async executeRun(runId: string): Promise<void> {
    const run = await this.repo.findRunById(runId);
    if (!run) return;

    const automation = await this.repo.findById(run.automationId);
    if (!automation) return;

    const version = await this.repo.getVersion(run.automationId, run.version);
    const definition: AutomationDefinition = version
      ? version.definition
      : { conditions: automation.conditions, actions: automation.actions };

    await this.repo.updateRunStatus(runId, 'running');

    try {
      for (let i = 0; i < definition.actions.length; i++) {
        const action = definition.actions[i]!;
        let step = await this.repo.findStep(runId, i);
        if (!step) {
          step = await this.repo.createStep({ runId, stepIndex: i, actionType: action.type });
        }

        // Idempotent: completed steps are not re-executed
        if (step.status === 'completed') continue;

        if (action.type === 'wait') {
          const delayMs = Number(action.config.delayMs || 0);
          if (step.status === 'waiting') {
            // Resume path: the wait has already elapsed — mark satisfied and continue
            await this.repo.updateStepStatus(step.id, 'completed', { executedAt: new Date() });
            continue;
          }
          await this.repo.updateStepStatus(step.id, 'waiting', { attempts: step.attempts + 1 });
          if (delayMs > 0) {
            await this.repo.updateRunStatus(runId, 'waiting');
            await this.dispatcher.enqueueDelayedStep(runId, i, delayMs);
            return; // resume later
          }
          continue;
        }

        await this.repo.updateStepStatus(step.id, 'executing', { attempts: step.attempts + 1 });
        try {
          const { result } = await this.executor.execute(action, {
            runId,
            stepIndex: i,
            memberId: extractMemberId(run.eventPayload),
            eventPayload: run.eventPayload,
          });
          await this.repo.updateStepStatus(step.id, 'completed', { result, executedAt: new Date() });
        } catch (err: any) {
          await this.repo.updateStepStatus(step.id, 'failed', { error: err.message || 'action failed' });
          throw err;
        }
      }

      await this.repo.updateRunStatus(runId, 'completed', { completedAt: new Date() });
    } catch (err: any) {
      await this.repo.updateRunStatus(runId, 'failed', { error: err.message || 'run failed', completedAt: new Date() });
    }
  }

  /**
   * Resumes a waiting run after a delay (called from the delayed queue job).
   */
  async resumeRun(runId: string): Promise<void> {
    const run = await this.repo.findRunById(runId);
    if (!run || run.status !== 'waiting') return;
    await this.executeRun(runId);
  }

  async listRuns(filter?: { automationId?: string; status?: string; limit?: number; offset?: number }): Promise<{ runs: AutomationRun[]; total: number }> {
    return this.repo.listRuns(filter);
  }

  async getRunSteps(runId: string): Promise<Array<{ stepIndex: number; actionType: string; status: string; result: Record<string, unknown> | null; error: string | null; attempts: number }>> {
    const steps = await this.repo.listSteps(runId);
    return steps.map((s) => ({
      stepIndex: s.stepIndex,
      actionType: s.actionType,
      status: s.status,
      result: s.result,
      error: s.error,
      attempts: s.attempts,
    }));
  }
}

function extractMemberId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const memberId = payload.memberId;
  return typeof memberId === 'string' ? memberId : null;
}
