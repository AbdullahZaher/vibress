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

  it("rejects secondary-publication global redirect imports before any writes", async () => {
    const deps = fixtures();
    const importer = new NativeImportProcessor(deps);
    await expect(importer.process({
      redirects: [{ source: "/global", destination: "/hijacked" }],
      settings: { site: { title: "Changed" } },
    }, "pub_alpha")).rejects.toThrow(/Global redirects/);
    expect(deps.redirectsService.createRedirect).not.toHaveBeenCalled();
    expect(deps.settingsService.updateSetting).not.toHaveBeenCalled();
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

  it("exports only the job publication's masked settings, never global redirects", async () => {
    const deps = fixtures();
    const collector = new NativeExportCollector(deps);
    const alpha = await collector.collect("pub_alpha");
    expect(deps.settingsService.getStaffSettings).toHaveBeenCalledWith("pub_alpha");
    expect(alpha).toEqual({
      settings: {
        site: { title: "Publication Title" },
        security: {},
      },
      redirects: [],
    });
    expect(deps.redirectsService.listRedirects).not.toHaveBeenCalled();

    const legacy = await collector.collect("pub_default");
    expect(deps.redirectsService.listRedirects).toHaveBeenCalledTimes(1);
    expect(Array.isArray(legacy.redirects)).toBe(true);
  });
});
