import { describe, expect, it, vi } from "vitest";
import type { ApprovedPluginPhysicalModel } from "../src/application/plugin-storage-migrations";
import { pluginPhysicalModelDigest } from "../src/application/plugin-storage-migrations";
import type {
  PluginScopedStorageRepository, PluginStorageRecord,
} from "../src/application/plugin-scoped-storage";
import { createHostPluginStorageSession } from "../src/application/plugin-storage-session";

const columns = [{ name: "title", type: "text", required: true }] as const;
const model: ApprovedPluginPhysicalModel = {
  key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns),
};

describe("EXT-203B3 Host-bound storage session", () => {
  it("never passes an extension-provided publication, SQL or plugin identifier to repository", async () => {
    const get = vi.fn<PluginScopedStorageRepository["get"]>(async () => null);
    const list = vi.fn<PluginScopedStorageRepository["list"]>(async () => ({ items: [] }));
    const create = vi.fn<PluginScopedStorageRepository["create"]>(async (_scope, _model, id, fields) => ({
      id, version: 1, fields,
    }));
    const update = vi.fn<PluginScopedStorageRepository["update"]>(async (_scope, _model, id, _version, fields) => ({
      id, version: 2, fields,
    }));
    const repo: PluginScopedStorageRepository = { get, list, create, update };
    const session = createHostPluginStorageSession(
      { pluginId: "p1", publicationId: "pub-a",
        actorUserId: "staff-1", requestId: "req-1", allowWrites: true }, [model], repo,
    );
    const saved = await session.storage.create("courses", "row-1", { title: "دورة" });
    expect(saved.fields.title).toBe("دورة");
    expect(create).toHaveBeenCalledWith(
      { pluginId: "p1", publicationId: "pub-a",
        audit: { actorUserId: "staff-1", requestId: "req-1" } },
      model, "row-1", { title: "دورة" },
    );
    await expect(session.storage.create("courses", "row-2", {
      publication_id: "pub-b", title: "forged",
    })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.storage.update("courses", "row-1", 1, {
      id: "row-evil",
    })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(session.storage.list("courses", 51))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    expect(Object.isFrozen(session.storage)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    session.close();
    await expect(session.storage.get("courses", "row-1"))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SESSION_CLOSED" });
    await expect(session.storage.create("courses", "row-2", { title: "retained" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SESSION_CLOSED" });
    expect(get).not.toHaveBeenCalled();
  });

  it("never lets a GET-bound session write even with a storage capability", async () => {
    const get = vi.fn<PluginScopedStorageRepository["get"]>(async () => null);
    const create = vi.fn<PluginScopedStorageRepository["create"]>(
      async () => ({ id: "x", version: 1, fields: { title: "x" } }),
    );
    const update = vi.fn<PluginScopedStorageRepository["update"]>(
      async () => ({ id: "x", version: 2, fields: { title: "x" } }),
    );
    const repo: PluginScopedStorageRepository = {
      get, create, update, list: async () => ({ items: [] }),
    };
    const session = createHostPluginStorageSession({
      pluginId: "p1", publicationId: "pub-a",
      actorUserId: "staff-1", requestId: "req-2",
      allowWrites: false,
    }, [model], repo);
    await expect(session.storage.get("courses", "read-only")).resolves.toBeNull();
    await expect(session.storage.create("courses", "new", { title: "unsafe" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_METHOD_DENIED" });
    await expect(session.storage.update("courses", "new", 1, { title: "unsafe" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_METHOD_DENIED" });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    session.close();
  });

  it("closes admission immediately and waits for an unawaited in-flight write", async () => {
    let finishWrite: ((record: PluginStorageRecord) => void) | undefined;
    const repository: PluginScopedStorageRepository = {
      get: async () => null,
      list: async () => ({ items: [] }),
      create: async () => new Promise<PluginStorageRecord>((resolve) => {
        finishWrite = resolve;
      }),
      update: async () => ({ id: "other", version: 2, fields: {} }),
    };
    const session = createHostPluginStorageSession({
      pluginId: "p1", publicationId: "pub-a", actorUserId: "staff-1",
      requestId: "req-drain", allowWrites: true,
    }, [model], repository);
    const operation = session.storage.create("courses", "record-1", { title: "saved" });
    let drained = false;
    const closing = session.close().then(() => { drained = true; });
    expect(drained).toBe(false);
    expect(finishWrite).toBeDefined();
    await expect(session.storage.create("courses", "record-2", { title: "late" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SESSION_CLOSED" });
    await Promise.resolve();
    expect(drained).toBe(false);

    finishWrite?.({ id: "record-1", version: 1, fields: { title: "saved" } });
    await expect(operation).resolves.toMatchObject({ id: "record-1" });
    await closing;
    expect(drained).toBe(true);
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("fails closure if a detached pending write fails and never hides rejection", async () => {
    let failWrite: ((error: Error) => void) | undefined;
    const repository: PluginScopedStorageRepository = {
      get: async () => null,
      list: async () => ({ items: [] }),
      create: async () => new Promise<PluginStorageRecord>((_resolve, reject) => {
        failWrite = reject;
      }),
      update: async () => ({ id: "unused", version: 2, fields: {} }),
    };
    const session = createHostPluginStorageSession({
      pluginId: "p1", publicationId: "pub-a", actorUserId: "staff-1",
      requestId: "req-failure", allowWrites: true,
    }, [model], repository);
    const operation = session.storage.create("courses", "record-1", { title: "save" });
    const closing = session.close();
    expect(failWrite).toBeDefined();
    failWrite?.(new Error("test persistence failure"));
    await expect(operation).rejects.toThrow("test persistence failure");
    await expect(closing).rejects.toMatchObject({
      code: "PLUGIN_STORAGE_IN_FLIGHT_FAILED",
    });
    await expect(session.close()).rejects.toMatchObject({
      code: "PLUGIN_STORAGE_IN_FLIGHT_FAILED",
    });
  });

  it("bounds the number of simultaneous request-scoped operations", async () => {
    const releases: Array<(record: PluginStorageRecord) => void> = [];
    const repository: PluginScopedStorageRepository = {
      get: async () => null,
      list: async () => ({ items: [] }),
      create: async () => new Promise<PluginStorageRecord>((resolve) => {
        releases.push(resolve);
      }),
      update: async () => ({ id: "unused", version: 2, fields: {} }),
    };
    const session = createHostPluginStorageSession({
      pluginId: "p1", publicationId: "pub-a", actorUserId: "staff-1",
      requestId: "req-limit", allowWrites: true,
    }, [model], repository);
    const operations = Array.from({ length: 16 }, (_, index) =>
      session.storage.create("courses", `row-${index}`, { title: "limited" }),
    );
    expect(releases).toHaveLength(16);
    await expect(session.storage.create("courses", "overflow", { title: "limited" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_BUSY" });
    const closing = session.close();
    for (const [index, release] of releases.entries()) {
      release({ id: `row-${index}`, version: 1, fields: { title: "limited" } });
    }
    await Promise.all(operations);
    await closing;
  });

  it("rejects a session without an authenticated Staff audit identity", () => {
    const repo: PluginScopedStorageRepository = {
      get: async () => null,
      list: async () => ({ items: [] }),
      create: async () => ({ id: "x", version: 1, fields: {} }),
      update: async () => ({ id: "x", version: 1, fields: {} }),
    };
    expect(() => createHostPluginStorageSession({
      pluginId: "p1", publicationId: "pub-a",
      actorUserId: "", requestId: "req-1",
    }, [model], repo)).toThrow(expect.objectContaining({
      code: "PLUGIN_STORAGE_INVALID",
    }));
    expect(() => createHostPluginStorageSession({
      pluginId: "p1", publicationId: "pub-a",
      actorUserId: "staff-1", requestId: "invalid\\nlog-injection",
    }, [model], repo)).toThrow(expect.objectContaining({
      code: "PLUGIN_STORAGE_INVALID",
    }));
  });

  it("rejects unapproved or checksum-drifted models before exposing storage", () => {
    const repo: PluginScopedStorageRepository = {
      get: async () => null,
      list: async () => ({ items: [] }),
      create: async () => ({ id: "x", version: 1, fields: {} }),
      update: async () => ({ id: "x", version: 1, fields: {} }),
    };
    expect(() => createHostPluginStorageSession(
      { pluginId: "p1", publicationId: "pub-a",
        actorUserId: "staff-1", requestId: "req-1" },
      [{ ...model, schemaSha256: "b".repeat(64) }], repo,
    )).toThrow();
  });
});
