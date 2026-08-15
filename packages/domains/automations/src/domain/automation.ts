export type AutomationStatus = "draft" | "active" | "inactive" | "error";

export type AutomationRunStatus =
  "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type AutomationStepStatus =
  "pending" | "executing" | "completed" | "failed" | "waiting" | "skipped";

export const ALLOWED_TRIGGERS = [
  "member.created",
  "subscription.activated",
  "subscription.cancelled",
  "newsletter.sent",
  "comment.created",
  "manual",
] as const;

export type AllowedTrigger = (typeof ALLOWED_TRIGGERS)[number];

export interface AutomationCondition {
  field: string;
  op: "equals" | "not_equals" | "exists";
  value?: unknown;
}

export interface AutomationAction {
  type:
    | "email"
    | "webhook"
    | "newsletter_subscribe"
    | "newsletter_unsubscribe"
    | "wait";
  config: Record<string, unknown>;
}

export interface Automation {
  id: string;
  key: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  status: AutomationStatus;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationVersion {
  id: string;
  automationId: string;
  version: number;
  definition: {
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  };
  createdAt: Date;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  version: number;
  runKey: string;
  triggerEvent: string;
  eventPayload: Record<string, unknown> | null;
  status: AutomationRunStatus;
  depth: number;
  correlationId: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface AutomationRunStep {
  id: string;
  runId: string;
  stepIndex: number;
  actionType: string;
  status: AutomationStepStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  executedAt: Date | null;
  createdAt: Date;
}

export interface AutomationDefinition {
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

export interface CreateAutomationData {
  id?: string | undefined;
  key: string;
  name: string;
  description?: string | null | undefined;
  triggerEvent: string;
  conditions?: AutomationCondition[] | undefined;
  actions?: AutomationAction[] | undefined;
  status?: AutomationStatus | undefined;
  createdBy?: string | null | undefined;
}
