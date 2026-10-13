import { describe, expect, it, vi } from "vitest";
import { NativeExportCollector, NativeImportProcessor } from "../import-export-processors";

function fixtures() {
  const settingsService = {
    updateSetting: vi.fn(async () => ({ })),
    getStaffSettings: vi.fn(async () => [
      { namespace: "site", settings: [
        { key: "title", value: "Publication Title", classification: "public" },
      ] },
      { namespace: "security", settings: [
        { key: "passwordHash", value: "••••••••", classification: "secret" },
      ] },
    ]),
  };
  const redirectsService = {
    createRedirect: vi.fn(async () => ({ })),
    listRedirects: vi.fn(async () => [{ source: "/secret", destination: "/global", statusCode: 301, enabled: true }]),
  };
  return { settingsService, redirectsService };
}

describe("publication-scoped native import/export processors", () => {
  it("writes settings only to the job publication", async () => {
    const deps = fixtures();
    const importer = new NativeImportProcessor(deps);
    const result = await importer.process({ settings: { site: { title: "Alpha" } } }, "pub_alpha");
    expect(result.redirects).toBe(0);
    expect(deps.settingsService.updateSetting).toHaveBeenCalledWith(
      "site", "title", "Alpha", null, "pub_alpha",
    );
  });

  it("imports redirects into the job publication", async () => {
    const deps = fixtures();
    const importer = new NativeImportProcessor(deps);
    const result = await importer.process({
      redirects: [{ source: "/moved", destination: "/alpha" }],
      settings: { site: { title: "Changed" } },
    }, "pub_alpha");
    expect(result.redirects).toBe(1);
    expect(deps.redirectsService.createRedirect).toHaveBeenCalledWith(
      { source: "/moved", destination: "/alpha", statusCode: 301 },
      null, "pub_alpha",
    );
    expect(deps.settingsService.updateSetting).toHaveBeenCalledWith(
      "site", "title", "Changed", null, "pub_alpha",
    );
  });

  it("does not import credentials or executable public code", async () => {
    const deps = fixtures();
    const importer = new NativeImportProcessor(deps);
    await importer.process({ settings: {
      email: { smtpPassword: "bad-secret" },
      code: { headerCode: "<script>alert(1)</script>" },
      site: { title: "Safe" },
    } }, "pub_alpha");
    expect(deps.settingsService.updateSetting).toHaveBeenCalledTimes(1);
    expect(deps.settingsService.updateSetting).toHaveBeenCalledWith("site", "title", "Safe", null, "pub_alpha");
  });

  it("exports job-owned redirects without exposing credentials", async () => {
    const deps = fixtures();
    const collector = new NativeExportCollector(deps);
    const alpha = await collector.collect("pub_alpha");
    expect(deps.settingsService.getStaffSettings).toHaveBeenCalledWith("pub_alpha");
    expect(alpha).toEqual({
      settings: {
        site: { title: "Publication Title" },
        security: {},
      },
      redirects: [{ source: "/secret", destination: "/global", statusCode: 301, enabled: true }],
    });
    expect(deps.redirectsService.listRedirects).toHaveBeenCalledWith("pub_alpha");

    const legacy = await collector.collect("pub_default");
    expect(deps.redirectsService.listRedirects).toHaveBeenCalledWith("pub_default");
    expect(deps.redirectsService.listRedirects).toHaveBeenCalledTimes(2);
    expect(Array.isArray(legacy.redirects)).toBe(true);
  });
});
