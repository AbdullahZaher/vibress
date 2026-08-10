import { AuditRepository, AuditListFilter } from '../domain/repository';
import { AuditEvent, CreateAuditEventData } from '../domain/audit-event';

export class AuditService {
  constructor(private auditRepo: AuditRepository) {}

  async record(data: CreateAuditEventData): Promise<AuditEvent> {
    return this.auditRepo.record(data);
  }

  async listAll(limit?: number): Promise<AuditEvent[]> {
    return this.auditRepo.listAll(limit);
  }

  /**
   * Append-only audit exploration with filters. There is no delete action.
   */
  async list(filter: AuditListFilter = {}): Promise<{ events: AuditEvent[]; total: number }> {
    return this.auditRepo.list(filter);
  }
}
