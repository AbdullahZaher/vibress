import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  validateAndExtractThemeZip,
  validateThemePath,
  ThemeZipError,
} from "../zip-validator";

async function createMockThemeZip(
  files: Record<string, string | Buffer>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Theme Core — ZIP Validator & Security", () => {
  const validManifest = JSON.stringify({
    id: "test-theme",
    name: "Test Theme",
    version: "1.0.0",
    themeApi: 1,
    settingsSchemaVersion: 1,
  });

  const validSettings = JSON.stringify({
    fields: [
      { key: "accentColor", type: "color", default: "#123456" },
      { key: "showAuthor", type: "boolean", default: true },
    ],
  });

  const minimalValidFiles = {
    "theme.json": validManifest,
    "settings.json": validSettings,
    "templates/home.liquid": "<h1>{{ site.title }}</h1>",
    "templates/post.liquid": "<h1>{{ post.title }}</h1>",
    "templates/page.liquid": "<h1>{{ page.title }}</h1>",
  };

  it("successfully extracts and validates a valid theme package", async () => {
    const zipBuffer = await createMockThemeZip(minimalValidFiles);
    const result = await validateAndExtractThemeZip(zipBuffer);

    expect(result.manifest.id).toBe("test-theme");
    expect(result.manifest.name).toBe("Test Theme");
    expect(result.manifest.version).toBe("1.0.0");
    expect(result.settingsSchema.accentColor).toBeDefined();
    expect(result.settingsSchema.accentColor?.default).toBe("#123456");
    expect(result.files.has("templates/home.liquid")).toBe(true);
    expect(result.files.has("templates/post.liquid")).toBe(true);
    expect(result.files.has("templates/page.liquid")).toBe(true);
  });

  it("handles theme with nested root directory correctly", async () => {
    const nestedFiles = {
      "my-theme-folder/theme.json": validManifest,
      "my-theme-folder/settings.json": validSettings,
      "my-theme-folder/templates/home.liquid": "<h1>Home</h1>",
      "my-theme-folder/templates/post.liquid": "<h1>Post</h1>",
      "my-theme-folder/templates/page.liquid": "<h1>Page</h1>",
      "my-theme-folder/assets/css/theme.css": "body { color: red; }",
    };
    const zipBuffer = await createMockThemeZip(nestedFiles);
    const result = await validateAndExtractThemeZip(zipBuffer);

    expect(result.manifest.id).toBe("test-theme");
    expect(result.files.has("templates/home.liquid")).toBe(true);
    expect(result.files.has("assets/css/theme.css")).toBe(true);
  });

  it("rejects non-zip files or corrupted zip", async () => {
    const invalidBuffer = Buffer.from("not a zip file at all");
    await expect(validateAndExtractThemeZip(invalidBuffer)).rejects.toThrow(
      ThemeZipError,
    );
  });

  it("rejects empty zip archive", async () => {
    const zip = new JSZip();
    const emptyZipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(validateAndExtractThemeZip(emptyZipBuffer)).rejects.toThrow(
      ThemeZipError,
    );
  });

  it("detects and rejects zip slip attacks (path traversal)", () => {
    expect(() => validateThemePath("../evil.js")).toThrow(ThemeZipError);
    expect(() => validateThemePath("/absolute/path.js")).toThrow(ThemeZipError);
    expect(() => validateThemePath("\\windows\\path.js")).toThrow(ThemeZipError);
    expect(() => validateThemePath("dir/../../evil.js")).toThrow(ThemeZipError);
    expect(() => validateThemePath("dir/null\0byte.js")).toThrow(ThemeZipError);
  });

  it("rejects forbidden executable and server code extensions (.ts, .tsx, .py, .sh)", async () => {
    const forbiddenFiles = [
      { ...minimalValidFiles, "server.ts": "export function run() {}" },
      { ...minimalValidFiles, "Component.tsx": "export const C = () => <div/>" },
      { ...minimalValidFiles, "script.sh": "#!/bin/sh\nrm -rf /" },
      { ...minimalValidFiles, "exploit.py": "import os; os.system('ls')" },
      { ...minimalValidFiles, "config.env": "SECRET=123" },
    ];

    for (const files of forbiddenFiles) {
      const zipBuffer = await createMockThemeZip(files);
      await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
        /forbidden executable or server code file/i,
      );
    }
  });

  it("rejects unknown file extensions not in allowlist", async () => {
    const invalidExtFiles = {
      ...minimalValidFiles,
      "data.customunknown": Buffer.from([0x00, 0x01, 0x02]),
    };
    const zipBuffer = await createMockThemeZip(invalidExtFiles);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /Theme file type not allowed/i,
    );
  });

  it("rejects packages missing theme.json manifest", async () => {
    const noManifest = {
      "templates/home.liquid": "<h1>Home</h1>",
      "templates/post.liquid": "<h1>Post</h1>",
      "templates/page.liquid": "<h1>Page</h1>",
    };
    const zipBuffer = await createMockThemeZip(noManifest);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /missing required theme.json manifest/i,
    );
  });

  it("rejects packages with incompatible themeApi version", async () => {
    const badApiManifest = {
      ...minimalValidFiles,
      "theme.json": JSON.stringify({
        id: "bad-api",
        name: "Bad API Theme",
        version: "1.0.0",
        themeApi: 99,
      }),
    };
    const zipBuffer = await createMockThemeZip(badApiManifest);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /uses API version 99/i,
    );
  });

  it("rejects packages missing required templates", async () => {
    const missingPost = {
      "theme.json": validManifest,
      "templates/home.liquid": "<h1>Home</h1>",
      "templates/page.liquid": "<h1>Page</h1>",
    };
    const zipBuffer = await createMockThemeZip(missingPost);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /missing required template files: templates\/post.liquid/i,
    );
  });

  it("rejects settings schema where a field has no default value", async () => {
    const badSettings = {
      ...minimalValidFiles,
      "settings.json": JSON.stringify({
        fields: [{ key: "noDefaultField", type: "string" }],
      }),
    };
    const zipBuffer = await createMockThemeZip(badSettings);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /missing mandatory default value/i,
    );
  });
});
