import { AuditEvent, CreateAuditEventData } from './audit-event';

export interface AuditListFilter {
  actorUserId?: string | undefined;
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  requestId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface AuditRepository {
  record(data: CreateAuditEventData): Promise<AuditEvent>;
  listAll(limit?: number): Promise<AuditEvent[]>;
  list(filter?: AuditListFilter): Promise<{ events: AuditEvent[]; total: number }>;
}
