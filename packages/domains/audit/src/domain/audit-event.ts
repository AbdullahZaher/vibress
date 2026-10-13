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

const SENSITIVE_AUDIT_METADATA_KEYS = [
  "password",
  "password_hash",
  "token",
  "secret",
  "authorization",
  "cookie",
  "set-cookie",
] as const;

const MAX_AUDIT_METADATA_SANITIZE_DEPTH = 20;
const REDACTED_AUDIT_VALUE = "[REDACTED]";

function isSensitiveAuditMetadataKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return SENSITIVE_AUDIT_METADATA_KEYS.some((sensitiveKey) =>
    normalizedKey.includes(sensitiveKey),
  );
}

function sanitizeAuditMetadataRecord(
  metadata: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = isSensitiveAuditMetadataKey(key)
      ? REDACTED_AUDIT_VALUE
      : sanitizeAuditMetadataValue(value, depth + 1);
  }

  return sanitized;
}

function sanitizeAuditMetadataValue(value: unknown, depth: number): unknown {
  if (depth > MAX_AUDIT_METADATA_SANITIZE_DEPTH) {
    return REDACTED_AUDIT_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditMetadataValue(entry, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeAuditMetadataRecord(value as Record<string, unknown>, depth);
  }

  return value;
}

// Redact any sensitive keys from metadata to prevent leaking secrets in audit logs
export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return null;
  return sanitizeAuditMetadataRecord(metadata, 0);
}
