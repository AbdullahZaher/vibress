import { describe, it, expect, vi } from 'vitest';
import { AutomationsService, AutomationDomainError, evaluateConditions, MAX_AUTOMATION_DEPTH } from '../src/application/automations-service';
import { AutomationRepository } from '../src/domain/repository';
import { Automation, AutomationRun, AutomationRunStep, AutomationAction } from '../src/domain/automation';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    key: 'welcome',
    name: 'Welcome',
    description: null,
    triggerEvent: 'member.created',
    conditions: [],
    actions: [{ type: 'webhook', config: { url: 'https://receiver.example.com/hook' } }],
    status: 'active',
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'r1',
    automationId: 'a1',
    version: 1,
    runKey: 'member.created:evt-1',
    triggerEvent: 'member.created',
    eventPayload: { memberId: 'm1' },
    status: 'pending',
    depth: 0,
    correlationId: null,
    error: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('evaluateConditions (declarative, no eval)', () => {
  it('empty conditions always pass', () => {
    expect(evaluateConditions([], {})).toBe(true);
  });

  it('equals matches on dotted field paths', () => {
    const payload = { subscription: { status: 'active', productId: 'p1' } };
    expect(evaluateConditions([{ field: 'subscription.status', op: 'equals', value: 'active' }], payload)).toBe(true);
    expect(evaluateConditions([{ field: 'subscription.status', op: 'equals', value: 'cancelled' }], payload)).toBe(false);
  });

  it('not_equals and exists work', () => {
    const payload = { memberId: 'm1' };
    expect(evaluateConditions([{ field: 'memberId', op: 'exists' }], payload)).toBe(true);
    expect(evaluateConditions([{ field: 'planId', op: 'exists' }], payload)).toBe(false);
    expect(evaluateConditions([{ field: 'memberId', op: 'not_equals', value: 'm2' }], payload)).toBe(true);
  });

  it('multiple conditions are ANDed', () => {
    const payload = { subscription: { status: 'active' }, productId: 'p1' };
    const conditions = [
      { field: 'subscription.status', op: 'equals' as const, value: 'active' },
      { field: 'productId', op: 'equals' as const, value: 'p1' },
    ];
    expect(evaluateConditions(conditions, payload)).toBe(true);
    expect(evaluateConditions([...conditions, { field: 'productId', op: 'equals' as const, value: 'p2' }], payload)).toBe(false);
  });
});

describe('AutomationsService', () => {
  const repo: AutomationRepository = {
    create: vi.fn(async (d) => makeAutomation({ key: d.key, name: d.name, triggerEvent: d.triggerEvent, conditions: d.conditions || [], actions: d.actions || [] })),
    findById: vi.fn(async () => null),
    findByKey: vi.fn(async () => null),
    update: vi.fn(async (id, d) => makeAutomation({ id })),
    updateStatus: vi.fn(async (id, status) => makeAutomation({ id, status })),
    list: vi.fn(async () => []),
    listActiveByTrigger: vi.fn(async () => []),
    createVersion: vi.fn(async () => ({ id: 'v1', automationId: 'a1', version: 1, definition: { conditions: [], actions: [] }, createdAt: new Date() })),
    getVersion: vi.fn(async () => null),
    createRun: vi.fn(async (d) => makeRun({ ...d, id: 'r-new' })),
    findRun: vi.fn(async () => null),
    findRunById: vi.fn(async () => null),
    listRuns: vi.fn(async () => ({ runs: [], total: 0 })),
    updateRunStatus: vi.fn(async () => undefined),
    incrementRunDepth: vi.fn(async () => undefined),
    createStep: vi.fn(async (d) => ({ id: 's1', runId: d.runId, stepIndex: d.stepIndex, actionType: d.actionType, status: 'pending', result: null, error: null, attempts: 0, executedAt: null, createdAt: new Date() })),
    findStep: vi.fn(async () => null),
    updateStepStatus: vi.fn(async () => undefined),
    listSteps: vi.fn(async () => []),
    findWaitingRuns: vi.fn(async () => []),
    findWaitingSteps: vi.fn(async () => []),
  };

  const dispatcher = { enqueueRun: vi.fn(async () => undefined), enqueueDelayedStep: vi.fn(async () => undefined) };
  const executor = { execute: vi.fn(async () => ({ result: { ok: true } })) };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new AutomationsService(
      (overrides.repo as AutomationRepository) || repo,
      (overrides.dispatcher as typeof dispatcher) || dispatcher,
      (overrides.executor as typeof executor) || executor,
    );
  }

  it('rejects an unsupported trigger', async () => {
    const service = makeService();
    await expect(service.createAutomation({ key: 'x', name: 'X', triggerEvent: 'pwn.all', actions: [] }, null))
      .rejects.toMatchObject({ code: 'INVALID_TRIGGER' });
  });

  it('rejects an automation with too many actions', async () => {
    const service = makeService();
    const actions = Array.from({ length: 11 }, () => ({ type: 'webhook' as const, config: { url: 'https://x.example.com' } }));
    await expect(service.createAutomation({ key: 'x', name: 'X', triggerEvent: 'member.created', actions }, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('creates an immutable v1 version snapshot', async () => {
    const service = makeService();
    await service.createAutomation({ key: 'welcome', name: 'Welcome', triggerEvent: 'member.created', actions: [{ type: 'webhook', config: { url: 'u' } }] }, 'u1');
    expect(repo.createVersion).toHaveBeenCalledWith(expect.any(String), 1, expect.any(Object));
  });

  it('cannot activate an automation with no actions', async () => {
    const repoWith: AutomationRepository = { ...repo, findById: vi.fn(async () => makeAutomation({ actions: [] })) };
    const service = makeService({ repo: repoWith });
    await expect(service.activateAutomation('a1', 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('handleEvent only matches active automations for the trigger', async () => {
    const repoWith: AutomationRepository = {
      ...repo,
      listActiveByTrigger: vi.fn(async (trigger) => trigger === 'member.created' ? [makeAutomation()] : []),
    };
    const service = makeService({ repo: repoWith });
    const created = await service.handleEvent('member.created', { memberId: 'm1' });
    expect(created).toBe(1);
    expect(await service.handleEvent('comment.created', { commentId: 'c1' })).toBe(0);
  });

  it('conditions filter which events create runs', async () => {
    const repoWith: AutomationRepository = {
      ...repo,
      listActiveByTrigger: vi.fn(async () => [makeAutomation({
        conditions: [{ field: 'productId', op: 'equals', value: 'premium' }],
      })]),
    };
    const service = makeService({ repo: repoWith });
    const created = await service.handleEvent('subscription.activated', { memberId: 'm1', productId: 'premium' });
    expect(created).toBe(1);
    const skipped = await service.handleEvent('subscription.activated', { memberId: 'm1', productId: 'other' });
    expect(skipped).toBe(0);
  });

  it('loop prevention: depth cap stops runaway runs', async () => {
    const repoWith: AutomationRepository = {
      ...repo,
      listActiveByTrigger: vi.fn(async () => [makeAutomation()]),
    };
    const service = makeService({ repo: repoWith });
    const created = await service.handleEvent('member.created', { memberId: 'm1' }, { depth: MAX_AUTOMATION_DEPTH });
    expect(created).toBe(0); // depth cap prevents the run
  });

  it('loop prevention: self-generated events (same automation) are skipped', async () => {
    const repoWith: AutomationRepository = {
      ...repo,
      listActiveByTrigger: vi.fn(async () => [makeAutomation()]),
    };
    const service = makeService({ repo: repoWith });
    const created = await service.handleEvent('member.created', { memberId: 'm1', originAutomationId: 'a1' });
    expect(created).toBe(0);
  });

  it('run idempotency: duplicate event identity creates one run', async () => {
    const repoWith: AutomationRepository = {
      ...repo,
      listActiveByTrigger: vi.fn(async () => [makeAutomation()]),
      findRun: vi.fn(async () => makeRun()), // run already exists
    };
    const service = makeService({ repo: repoWith });
    const created = await service.handleEvent('member.created', { memberId: 'm1', eventId: 'evt-1' });
    expect(created).toBe(0); // deduped
  });

  it('executeRun completes steps and marks the run completed', async () => {
    const run = makeRun();
    const repoWith: AutomationRepository = {
      ...repo,
      findRunById: vi.fn(async () => run),
      findById: vi.fn(async () => makeAutomation()),
      getVersion: vi.fn(async () => ({ id: 'v1', automationId: 'a1', version: 1, definition: { conditions: [], actions: [{ type: 'webhook', config: { url: 'u' } }] }, createdAt: new Date() })),
      findStep: vi.fn(async () => null),
    };
    const service = makeService({ repo: repoWith });
    await service.executeRun('r1');
    expect(repoWith.updateRunStatus).toHaveBeenCalledWith('r1', 'completed', expect.anything());
  });

  it('wait actions persist run state and schedule a delayed resume', async () => {
    const run = makeRun();
    const repoWith: AutomationRepository = {
      ...repo,
      findRunById: vi.fn(async () => run),
      findById: vi.fn(async () => makeAutomation()),
      getVersion: vi.fn(async () => ({ id: 'v1', automationId: 'a1', version: 1, definition: { conditions: [], actions: [{ type: 'wait', config: { delayMs: 5000 } }] }, createdAt: new Date() })),
      findStep: vi.fn(async () => null),
      createStep: vi.fn(async (d) => ({ id: 's1', runId: d.runId, stepIndex: d.stepIndex, actionType: d.actionType, status: 'pending', result: null, error: null, attempts: 0, executedAt: null, createdAt: new Date() })),
      updateStepStatus: vi.fn(async () => undefined),
    };
    const dispatcherWith = { enqueueRun: vi.fn(async () => undefined), enqueueDelayedStep: vi.fn(async () => undefined) };
    const service = makeService({ repo: repoWith, dispatcher: dispatcherWith });
    await service.executeRun('r1');
    expect(repoWith.updateRunStatus).toHaveBeenCalledWith('r1', 'waiting');
    expect(dispatcherWith.enqueueDelayedStep).toHaveBeenCalledWith('r1', 0, 5000);
  });

  it('failed actions mark the step and run as failed', async () => {
    const run = makeRun();
    const repoWith: AutomationRepository = {
      ...repo,
      findRunById: vi.fn(async () => run),
      findById: vi.fn(async () => makeAutomation()),
      getVersion: vi.fn(async () => ({ id: 'v1', automationId: 'a1', version: 1, definition: { conditions: [], actions: [{ type: 'email', config: {} }] }, createdAt: new Date() })),
      findStep: vi.fn(async () => null),
    };
    const executorWith = { execute: vi.fn(async () => { throw new Error('smtp down'); }) };
    const service = makeService({ repo: repoWith, executor: executorWith });
    await service.executeRun('r1');
    expect(repoWith.updateRunStatus).toHaveBeenCalledWith('r1', 'failed', expect.anything());
  });

  it('completed steps are not re-executed (retry idempotency)', async () => {
    const run = makeRun();
    const completedStep = { id: 's1', runId: 'r1', stepIndex: 0, actionType: 'webhook', status: 'completed', result: { ok: true }, error: null, attempts: 1, executedAt: new Date(), createdAt: new Date() };
    const repoWith: AutomationRepository = {
      ...repo,
      findRunById: vi.fn(async () => run),
      findById: vi.fn(async () => makeAutomation()),
      getVersion: vi.fn(async () => ({ id: 'v1', automationId: 'a1', version: 1, definition: { conditions: [], actions: [{ type: 'webhook', config: { url: 'u' } }] }, createdAt: new Date() })),
      findStep: vi.fn(async () => completedStep),
    };
    const executorWith = { execute: vi.fn(async () => ({ result: {} })) };
    const service = makeService({ repo: repoWith, executor: executorWith });
    await service.executeRun('r1');
    expect(executorWith.execute).not.toHaveBeenCalled();
  });

  it('manual run requires an active automation', async () => {
    const repoWith: AutomationRepository = { ...repo, findById: vi.fn(async () => makeAutomation({ status: 'draft' })) };
    const service = makeService({ repo: repoWith });
    await expect(service.manualRun('a1', 'u1')).rejects.toMatchObject({ code: 'AUTOMATION_NOT_ACTIVE' });
  });
});
