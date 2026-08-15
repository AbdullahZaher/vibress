import {
  Automation,
  AutomationVersion,
  AutomationRun,
  AutomationRunStep,
  AutomationDefinition,
  CreateAutomationData,
  AutomationStatus,
} from "./automation";

export interface AutomationRepository {
  create(data: CreateAutomationData): Promise<Automation>;
  findById(id: string): Promise<Automation | null>;
  findByKey(key: string): Promise<Automation | null>;
  update(id: string, data: Partial<CreateAutomationData>): Promise<Automation>;
  updateStatus(id: string, status: AutomationStatus): Promise<Automation>;
  list(): Promise<Automation[]>;
  listActiveByTrigger(triggerEvent: string): Promise<Automation[]>;

  createVersion(
    automationId: string,
    version: number,
    definition: AutomationDefinition,
  ): Promise<AutomationVersion>;
  getVersion(
    automationId: string,
    version: number,
  ): Promise<AutomationVersion | null>;

  createRun(data: {
    automationId: string;
    version: number;
    runKey: string;
    triggerEvent: string;
    eventPayload: Record<string, unknown> | null;
    depth: number;
    correlationId: string | null;
  }): Promise<AutomationRun>;
  findRun(automationId: string, runKey: string): Promise<AutomationRun | null>;
  findRunById(id: string): Promise<AutomationRun | null>;
  listRuns(filter?: {
    automationId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ runs: AutomationRun[]; total: number }>;
  updateRunStatus(
    id: string,
    status: string,
    patch?: Partial<AutomationRun>,
  ): Promise<void>;
  incrementRunDepth(id: string): Promise<void>;

  createStep(data: {
    runId: string;
    stepIndex: number;
    actionType: string;
  }): Promise<AutomationRunStep>;
  findStep(runId: string, stepIndex: number): Promise<AutomationRunStep | null>;
  updateStepStatus(
    id: string,
    status: string,
    patch?: Partial<AutomationRunStep>,
  ): Promise<void>;
  listSteps(runId: string): Promise<AutomationRunStep[]>;
  findWaitingRuns(limit: number): Promise<AutomationRun[]>;
  findWaitingSteps(limit: number): Promise<AutomationRunStep[]>;
}
