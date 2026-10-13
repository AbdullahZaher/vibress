import { describe, expect, it } from "vitest";
import {
  AuditEvent,
  AuditListFilter,
  AuditRepository,
  AuditService,
  CreateAuditEventData,
} from "@vibress/audit";

class FakeAuditRepository implements AuditRepository {
  recorded: CreateAuditEventData | null = null;
  listed: AuditListFilter | undefined;

  async record(data: CreateAuditEventData): Promise<AuditEvent> {
    this.recorded = data;
    return {
      id: data.id ?? "audit_1",
      publicationId: data.publicationId ?? null,
      actorUserId: data.actorUserId ?? null,
      action: data.action,
      targetType: data.targetType ?? null,
      targetId: data.targetId ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      requestId: data.requestId ?? null,
      metadata: data.metadata ?? null,
      createdAt: new Date("2026-10-13T00:00:00.000Z"),
    };
  }

  async listAll(_limit?: number): Promise<AuditEvent[]> {
    return [];
  }

  async list(
    filter?: AuditListFilter,
  ): Promise<{ events: AuditEvent[]; total: number }> {
    this.listed = filter;
    return { events: [], total: 0 };
  }
}

describe("audit publication ownership contract", () => {
  it("preserves explicit publication ownership when recording events", async () => {
    const repo = new FakeAuditRepository();
    const service = new AuditService(repo);

    const event = await service.record({
      publicationId: "pub_alpha",
      actorUserId: "user_1",
      action: "setting.updated",
      targetType: "setting",
      targetId: "site.title",
    });

    expect(event.publicationId).toBe("pub_alpha");
    expect(repo.recorded?.publicationId).toBe("pub_alpha");
  });

  it("passes publication filters through to repository list operations", async () => {
    const repo = new FakeAuditRepository();
    const service = new AuditService(repo);

    await service.list({ publicationId: "pub_beta", action: "post.updated" });

    expect(repo.listed).toMatchObject({
      publicationId: "pub_beta",
      action: "post.updated",
    });
  });
});
