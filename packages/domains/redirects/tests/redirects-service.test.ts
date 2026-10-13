import { describe, it, expect, vi } from "vitest";
import {
  RedirectsService,
  RedirectDomainError,
  PROTECTED_ROUTE_PREFIXES,
} from "../src/application/redirects-service";
import {
  RedirectRepository,
  Redirect,
  CreateRedirectData,
} from "../src/domain/redirect";

function makeRedirect(overrides: Partial<Redirect> = {}): Redirect {
  return {
    id: "r1",
    publicationId: "pub_default",
    source: "/old-path",
    destination: "/new-path",
    statusCode: 301,
    enabled: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("RedirectsService", () => {
  const repo: RedirectRepository = {
    create: vi.fn(async (d) =>
      makeRedirect({ source: d.source, destination: d.destination }),
    ),
    findById: vi.fn(async () => null),
    findBySource: vi.fn(async () => null),
    update: vi.fn(async (id, d) => makeRedirect({ id, ...d })),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    listEnabled: vi.fn(async () => []),
  };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new RedirectsService((overrides.repo as RedirectRepository) || repo);
  }

  it("creates a valid internal redirect", async () => {
    const service = makeService();
    const redirect = await service.createRedirect(
      { source: "/old", destination: "/new" },
      "u1",
    );
    expect(redirect.source).toBe("/old");
  });

  it("rejects a non-relative source", async () => {
    const service = makeService();
    await expect(
      service.createRedirect({ source: "old", destination: "/new" }, null),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE" });
    await expect(
      service.createRedirect(
        { source: "//evil.com", destination: "/new" },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });

  it("rejects redirecting protected routes", async () => {
    const service = makeService();
    for (const prefix of PROTECTED_ROUTE_PREFIXES) {
      await expect(
        service.createRedirect(
          { source: `${prefix}/x`, destination: "/new" },
          null,
        ),
      ).rejects.toMatchObject({ code: "PROTECTED_ROUTE" });
    }
  });

  it("rejects unsafe external destinations", async () => {
    const service = makeService();
    await expect(
      service.createRedirect(
        { source: "/a", destination: "javascript:alert(1)" },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DESTINATION" });
    await expect(
      service.createRedirect(
        { source: "/a", destination: "data:text/html,x" },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DESTINATION" });
    await expect(
      service.createRedirect(
        { source: "/a", destination: "ftp://x.com" },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DESTINATION" });
  });

  it("rejects backslash-relative destinations that URL parsers may treat as external hosts", async () => {
    const service = makeService();
    await expect(
      service.createRedirect({source: "/unsafe", destination: "/\\\\evil.example"}, null),
    ).rejects.toMatchObject({code: "INVALID_DESTINATION"});
  });

  it("allows http/https external destinations", async () => {
    const service = makeService();
    const redirect = await service.createRedirect(
      { source: "/out", destination: "https://example.com/page" },
      null,
    );
    expect(redirect.destination).toBe("https://example.com/page");
  });

  it("rejects an unsupported status code", async () => {
    const service = makeService();
    await expect(
      service.createRedirect(
        { source: "/a", destination: "/b", statusCode: 200 },
        null,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_CODE" });
  });

  it("rejects a duplicate source", async () => {
    const repoWith: RedirectRepository = {
      ...repo,
      findBySource: vi.fn(async () => makeRedirect()),
    };
    const service = makeService({ repo: repoWith });
    await expect(
      service.createRedirect(
        { source: "/old-path", destination: "/new" },
        null,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_EXISTS" });
  });

  it("resolves Arabic and other Unicode source paths in their browser-encoded form", async () => {
    const readable = "/مرحبا";
    const rule = makeRedirect({source: readable, destination: "/أهلا"});
    const repoWith: RedirectRepository = {
      ...repo,
      findBySource: vi.fn(async (source) => source === readable ? rule : null),
    };
    const service = makeService({repo: repoWith});
    expect(await service.resolve(encodeURI(readable), "pub_default"))
      .toEqual({destination: "/أهلا", statusCode: 301});
  });

  it("rejects percent-encoded protected redirect sources and public resolution", async () => {
    const service = makeService();
    await expect(service.createRedirect({
      source: "/%61pi/private", destination: "/hijack",
    }, null)).rejects.toMatchObject({code: "PROTECTED_ROUTE"});
    expect(await service.resolve("/%61pi/private", "pub_default")).toBeNull();
    await expect(service.createRedirect({
      source: "/%2Fapi", destination: "/hijack",
    }, null)).rejects.toMatchObject({code: "INVALID_SOURCE"});
  });

  it("resolves a redirect chain with loop protection", async () => {
    const redirects = [
      makeRedirect({
        id: "a",
        source: "/a",
        destination: "/b",
        statusCode: 301,
      }),
      makeRedirect({
        id: "b",
        source: "/b",
        destination: "/c",
        statusCode: 302,
      }),
    ];
    const repoWith: RedirectRepository = {
      ...repo,
      findBySource: vi.fn(async (source) => redirects.find((r) => r.source === source) ?? null),
    };
    const service = makeService({ repo: repoWith });
    const resolved = await service.resolve("/a");
    expect(resolved).toEqual({ destination: "/c", statusCode: 302 });
  });

  it("detects and breaks a redirect loop", async () => {
    const redirects = [
      makeRedirect({ id: "a", source: "/a", destination: "/b" }),
      makeRedirect({ id: "b", source: "/b", destination: "/a" }),
    ];
    const repoWith: RedirectRepository = {
      ...repo,
      findBySource: vi.fn(async (source) => redirects.find((r) => r.source === source) ?? null),
    };
    const service = makeService({ repo: repoWith });
    const resolved = await service.resolve("/a");
    expect(resolved).toBeNull(); // loop broken
  });
  it("scopes duplicate checks and creation to the authorized publication", async () => {
    const service = makeService();
    await service.createRedirect({ source: "/shared", destination: "/alpha" }, "staff", "pub_alpha");
    expect(repo.findBySource).toHaveBeenCalledWith("/shared", "pub_alpha");
    expect(repo.create).toHaveBeenCalledWith(
      { source: "/shared", destination: "/alpha" }, "pub_alpha",
    );
  });

  it("prevents modification or deletion of redirects outside the requested publication", async () => {
    const scopedRepo: RedirectRepository = {
      ...repo,
      findById: vi.fn(async (_id, publicationId) =>
        publicationId === "pub_alpha" ? makeRedirect({publicationId: "pub_alpha"}) : null,
      ),
      update: vi.fn(async (_id, data, publicationId) => makeRedirect({...data, publicationId})),
      delete: vi.fn(async () => undefined),
    };
    const service = makeService({repo: scopedRepo});
    await expect(service.updateRedirect("r1", {destination: "/stolen"}, "staff", "pub_beta"))
      .rejects.toMatchObject({code: "REDIRECT_NOT_FOUND"});
    await service.deleteRedirect("r1", "staff", "pub_beta");
    expect(scopedRepo.update).not.toHaveBeenCalled();
    expect(scopedRepo.delete).not.toHaveBeenCalled();
    await service.updateRedirect("r1", {destination: "/owned"}, "staff", "pub_alpha");
    expect(scopedRepo.update).toHaveBeenCalledWith("r1", {destination: "/owned"}, "pub_alpha");
  });

  it("passes publication ownership into the public enabled-rules lookup", async () => {
    const scopedRepo: RedirectRepository = {
      ...repo,
      findBySource: vi.fn(async (source, publicationId) =>
        source === "/shared" ? makeRedirect({
          source, destination: publicationId === "pub_alpha" ? "/alpha" : "/beta",
          publicationId: publicationId ?? "pub_default",
        }) : null,
      ),
    };
    const service = makeService({repo: scopedRepo});
    expect(await service.resolve("/shared", "pub_alpha")).toEqual({destination: "/alpha", statusCode: 301});
    expect(await service.resolve("/shared", "pub_beta")).toEqual({destination: "/beta", statusCode: 301});
  });

});
