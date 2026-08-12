export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAuditEventData {
  id?: string | undefined;
  actorUserId?: string | null | undefined;
  action: string;
  targetType?: string | null | undefined;
  targetId?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

// Redact any sensitive keys from metadata to prevent leaking secrets in audit logs
export function sanitizeAuditMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  const sensitiveKeys = ['password', 'password_hash', 'token', 'secret', 'authorization', 'cookie', 'set-cookie'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
