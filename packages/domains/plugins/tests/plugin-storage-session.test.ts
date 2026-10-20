import { describe, expect, it, vi } from "vitest";
import type { ApprovedPluginPhysicalModel } from "../src/application/plugin-storage-migrations";
import { pluginPhysicalModelDigest } from "../src/application/plugin-storage-migrations";
import type { PluginScopedStorageRepository } from "../src/application/plugin-scoped-storage";
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
      { pluginId: "p1", publicationId: "pub-a" }, [model], repo,
    );
    const saved = await session.storage.create("courses", "row-1", { title: "دورة" });
    expect(saved.fields.title).toBe("دورة");
    expect(create).toHaveBeenCalledWith(
      { pluginId: "p1", publicationId: "pub-a" }, model, "row-1", { title: "دورة" },
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

  it("rejects unapproved or checksum-drifted models before exposing storage", () => {
    const repo: PluginScopedStorageRepository = {
      get: async () => null,
      list: async () => ({ items: [] }),
      create: async () => ({ id: "x", version: 1, fields: {} }),
      update: async () => ({ id: "x", version: 1, fields: {} }),
    };
    expect(() => createHostPluginStorageSession(
      { pluginId: "p1", publicationId: "pub-a" },
      [{ ...model, schemaSha256: "b".repeat(64) }], repo,
    )).toThrow();
  });
});
