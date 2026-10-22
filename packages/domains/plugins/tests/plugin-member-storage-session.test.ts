import { describe, expect, it, vi } from "vitest";
import type { ApprovedPluginPhysicalModel } from "../src/application/plugin-storage-migrations";
import { pluginPhysicalModelDigest } from "../src/application/plugin-storage-migrations";
import {
  createHostPluginMemberStorageSession,
  type PluginMemberStorageRepository,
  type MemberStorageHostScope,
} from "../src/application/plugin-member-storage-session";
import type { PluginStorageRecord } from "../src/application/plugin-scoped-storage";

const columns = [
  { name: "course_key", type: "text", required: true },
  { name: "completed", type: "boolean", required: false },
] as const;
const model: ApprovedPluginPhysicalModel = {
  key: "enrollment", columns, schemaSha256: pluginPhysicalModelDigest(columns),
};
const base: MemberStorageHostScope = {
  pluginId: "plugin-a", publicationId: "pub-a", memberId: "member-a",
  requestId: "request-a", allowWrites: true,
};

function repository(): PluginMemberStorageRepository {
  return {
    get: vi.fn(async () => null),
    list: vi.fn(async () => ({ items: [] })),
    create: vi.fn(async (_scope, _model, id, fields) => ({ id, version: 1, fields })),
    update: vi.fn(async (_scope, _model, id, version, fields) => ({
      id, version: version + 1, fields,
    })),
  };
}

describe("EXT-205 Member-owned scoped storage", () => {
  it("binds the real Member and publication inside Host-only scope", async () => {
    const repo = repository();
    const session = createHostPluginMemberStorageSession(base, [model], repo);
    expect(Object.isFrozen(session.memberStorage)).toBe(true);
    const result = await session.memberStorage.create("enrollment", "course-01", {
      course_key: "دورة", completed: false,
    });
    expect(result).toEqual({ id: "course-01", version: 1,
      fields: { course_key: "دورة", completed: false } });
    expect(repo.create).toHaveBeenCalledWith(base, model, "course-01", {
      course_key: "دورة", completed: false,
    });
    await expect(session.memberStorage.create("enrollment", "course-02", {
      course_key: "x", publication_id: "pub-b",
    })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.memberStorage.create("enrollment", "course-02", {
      course_key: "x", memberId: "member-b",
    })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.memberStorage.update("enrollment", "course-01", 0, {
      completed: true,
    })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.memberStorage.get("unapproved", "course-01"))
      .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_MODEL_DENIED" });
    await expect(session.memberStorage.get("enrollment", "../outside"))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.memberStorage.list("enrollment", 51))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.memberStorage.list("enrollment", 1, "../outside"))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.memberStorage.list("enrollment", 10)).resolves.toEqual({ items: [] });
    expect(repo.list).toHaveBeenCalledWith(base, model, 10, undefined);
    expect(repo.create).toHaveBeenCalledTimes(1);
    await expect(session.close()).resolves.toBeUndefined();
    await expect(session.memberStorage.get("enrollment", "course-01"))
      .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_SESSION_CLOSED" });
  });

  it("denies mutation on GET regardless of declared capabilities", async () => {
    const repo = repository();
    const session = createHostPluginMemberStorageSession({ ...base, allowWrites: false },
      [model], repo);
    await expect(session.memberStorage.get("enrollment", "course-01")).resolves.toBeNull();
    await expect(session.memberStorage.create("enrollment", "course-01", {
      course_key: "course-01",
    })).rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_METHOD_DENIED" });
    await expect(session.memberStorage.update("enrollment", "course-01", 1, {
      completed: true,
    })).rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_METHOD_DENIED" });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    await session.close();
  });

  it("drains in-flight writes and fails closure after rejected persistence", async () => {
    let finish: ((row: PluginStorageRecord) => void) | undefined;
    const repo = repository();
    repo.create = vi.fn(() => new Promise<PluginStorageRecord>((resolve) => {
      finish = resolve;
    }));
    const session = createHostPluginMemberStorageSession(base, [model], repo);
    const work = session.memberStorage.create("enrollment", "course-01", {
      course_key: "course-01",
    });
    let drained = false;
    const closing = session.close().then(() => { drained = true; });
    expect(drained).toBe(false);
    await expect(session.memberStorage.get("enrollment", "course-01"))
      .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_SESSION_CLOSED" });
    finish?.({ id: "course-01", version: 1, fields: { course_key: "course-01" } });
    await expect(work).resolves.toMatchObject({ id: "course-01" });
    await closing;
    expect(drained).toBe(true);

    const repo2 = repository();
    let rejectPending: ((reason: Error) => void) | undefined;
    repo2.create = vi.fn(() => new Promise<PluginStorageRecord>((_resolve, reject) => {
      rejectPending = reject;
    }));
    const failedSession = createHostPluginMemberStorageSession(base, [model], repo2);
    const pending = failedSession.memberStorage.create("enrollment", "course-02", {
      course_key: "course-02",
    });
    const closingFailed = failedSession.close();
    rejectPending?.(new Error("DB offline"));
    await expect(pending).rejects.toThrow("DB offline");
    await expect(closingFailed).rejects.toMatchObject({
      code: "PLUGIN_MEMBER_STORAGE_IN_FLIGHT_FAILED",
    });
  });

  it("rejects forged binding, unapproved models and concurrent overload", async () => {
    const repo = repository();
    expect(() => createHostPluginMemberStorageSession({
      ...base, memberId: "", allowWrites: true,
    }, [model], repo)).toThrow();
    expect(() => createHostPluginMemberStorageSession({ ...base,
      requestId: "evil\ntrace",
    }, [model], repo)).toThrow();
    expect(() => createHostPluginMemberStorageSession(base, [
      { ...model, schemaSha256: "f".repeat(64) },
    ], repo)).toThrow();
    const forbiddenColumns = [{ name: "member_id", type: "text", required: true }] as const;
    expect(() => createHostPluginMemberStorageSession(base, [{
      key: "spoofed", columns: forbiddenColumns,
      schemaSha256: pluginPhysicalModelDigest(forbiddenColumns),
    }], repo)).toThrow();
    const releases: Array<(row: PluginStorageRecord | null) => void> = [];
    repo.get = vi.fn(() => new Promise<PluginStorageRecord | null>((resolve) => { releases.push(resolve); }));
    const session = createHostPluginMemberStorageSession(base, [model], repo);
    const operations = Array.from({ length: 16 }, (_, i) =>
      session.memberStorage.get("enrollment", `course-${i}`));
    await expect(session.memberStorage.get("enrollment", "overflow"))
      .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_BUSY" });
    const closing = session.close();
    for (const release of releases) release(null);
    await Promise.all(operations);
    await closing;
  });
});
