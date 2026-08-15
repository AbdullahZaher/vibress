import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  ImportExportService,
  ImportExportDomainError,
  validateImportEnvelope,
  assertSafeArchivePath,
  MAX_IMPORT_FILE_SIZE,
  MAX_ARCHIVE_ENTRIES,
} from "../src/application/import-export-service";
import { JobRepository, ImportExportJob } from "../src/domain/job";

beforeAll(() => {
  process.env.VIBRESS_ENCRYPTION_KEY =
    process.env.VIBRESS_ENCRYPTION_KEY || "test-key";
});

function makeJob(overrides: Partial<ImportExportJob> = {}): ImportExportJob {
  return {
    id: "j1",
    type: "import",
    status: "pending",
    requestedBy: null,
    progress: 0,
    errorSummary: null,
    artifactKey: null,
    artifactExpiresAt: null,
    summary: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("validateImportEnvelope", () => {
  it("accepts a valid versioned vibress envelope", () => {
    const parsed = validateImportEnvelope({
      format: "vibress",
      version: 1,
      exportedAt: "2026-01-01",
      data: { redirects: [] },
    });
    expect(parsed.format).toBe("vibress");
    expect(parsed.version).toBe(1);
  });

  it("rejects a wrong format name", () => {
    expect(() =>
      validateImportEnvelope({
        format: "invalid-format",
        version: 1,
        data: {},
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_FORMAT" }));
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      validateImportEnvelope({ format: "vibress", version: 99, data: {} }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_VERSION" }));
  });

  it("rejects a missing data object", () => {
    expect(() =>
      validateImportEnvelope({ format: "vibress", version: 1 }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_FORMAT" }));
  });

  it("rejects an arbitrary object shape (no format field)", () => {
    expect(() => validateImportEnvelope({ foo: "bar" })).toThrowError(
      expect.objectContaining({ code: "INVALID_FORMAT" }),
    );
  });
});

describe("assertSafeArchivePath (zip-slip defense)", () => {
  it("accepts normal relative paths", () => {
    expect(assertSafeArchivePath("posts/hello.json")).toBe("posts/hello.json");
  });

  it("rejects absolute paths", () => {
    expect(() => assertSafeArchivePath("/etc/passwd")).toThrowError(
      expect.objectContaining({ code: "PATH_TRAVERSAL" }),
    );
  });

  it("rejects path traversal (..)", () => {
    expect(() => assertSafeArchivePath("../../etc/passwd")).toThrowError(
      expect.objectContaining({ code: "PATH_TRAVERSAL" }),
    );
    expect(() => assertSafeArchivePath("posts/../../../x")).toThrowError(
      expect.objectContaining({ code: "PATH_TRAVERSAL" }),
    );
  });

  it("rejects Windows drive letters", () => {
    expect(() => assertSafeArchivePath("C:\\windows\\system32")).toThrowError(
      expect.objectContaining({ code: "PATH_TRAVERSAL" }),
    );
  });

  it("normalizes backslashes", () => {
    expect(assertSafeArchivePath("posts\\hello.json")).toBe("posts/hello.json");
  });
});

describe("ImportExportService", () => {
  const jobRepo: JobRepository = {
    create: vi.fn(async (d) =>
      makeJob({ type: d.type, requestedBy: d.requestedBy }),
    ),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => ({ jobs: [], total: 0 })),
    updateStatus: vi.fn(async () => undefined),
  };
  const importer = {
    process: vi.fn(async () => ({ posts: 1, pages: 0, tags: 0, redirects: 2 })),
  };
  const exporter = {
    collect: vi.fn(async () => ({ settings: {}, redirects: [] })),
  };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new ImportExportService(
      (overrides.jobRepo as JobRepository) || jobRepo,
      (overrides.importer as typeof importer) || importer,
      (overrides.exporter as typeof exporter) || exporter,
    );
  }

  it("creates import and export jobs", async () => {
    const service = makeService();
    const importJob = await service.createImportJob("u1");
    expect(importJob.type).toBe("import");
    const exportJob = await service.createExportJob("u1");
    expect(exportJob.type).toBe("export");
  });

  it("runImport validates the envelope and marks the job completed", async () => {
    const jobRepoWith: JobRepository = {
      ...jobRepo,
      findById: vi.fn(async () => makeJob()),
    };
    const service = makeService({ jobRepo: jobRepoWith });
    const result = await service.runImport("j1", {
      format: "vibress",
      version: 1,
      data: { redirects: [] },
    });
    expect(result.redirects).toBe(2);
    expect(jobRepoWith.updateStatus).toHaveBeenCalledWith(
      "j1",
      "completed",
      expect.anything(),
    );
  });

  it("runImport rejects an invalid envelope", async () => {
    const jobRepoWith: JobRepository = {
      ...jobRepo,
      findById: vi.fn(async () => makeJob()),
    };
    const service = makeService({ jobRepo: jobRepoWith });
    await expect(
      service.runImport("j1", { format: "evil", version: 1, data: {} }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("runImport marks the job failed on processor errors", async () => {
    const jobRepoWith: JobRepository = {
      ...jobRepo,
      findById: vi.fn(async () => makeJob()),
    };
    const importerWith = {
      process: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const service = makeService({
      jobRepo: jobRepoWith,
      importer: importerWith,
    });
    await expect(
      service.runImport("j1", { format: "vibress", version: 1, data: {} }),
    ).rejects.toThrow("boom");
    expect(jobRepoWith.updateStatus).toHaveBeenCalledWith(
      "j1",
      "failed",
      expect.objectContaining({ errorSummary: "boom" }),
    );
  });

  it("runExport builds a versioned envelope and sets artifact retention", async () => {
    const jobRepoWith: JobRepository = {
      ...jobRepo,
      findById: vi.fn(async () => makeJob()),
    };
    const service = makeService({ jobRepo: jobRepoWith });
    const { envelope } = await service.runExport("j1");
    expect((envelope as any).format).toBe("vibress");
    expect((envelope as any).version).toBe(1);
    expect(jobRepoWith.updateStatus).toHaveBeenCalledWith(
      "j1",
      "completed",
      expect.objectContaining({ artifactKey: expect.any(String) }),
    );
    const patch = (jobRepoWith.updateStatus as any).mock.calls.at(-1)[2];
    expect(patch.artifactExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
