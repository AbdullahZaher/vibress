import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  validateAndExtractThemeZip,
  validateThemePath,
  ThemeZipError,
} from "../zip-validator";

describe("Theme Core — ZIP Validator & Security", () => {
  const minimalValidFiles: Record<string, string | Buffer> = {
    "theme.json": JSON.stringify({
      id: "test-theme",
      name: "Test Theme",
      version: "1.0.0",
      themeApi: 1,
    }),
    "settings.json": JSON.stringify({
      fields: [
        {
          key: "accentColor",
          type: "color",
          default: "#6366f1",
        },
      ],
    }),
    "templates/home.liquid": "<h1>Home</h1>",
    "templates/post.liquid": "<h1>Post</h1>",
    "templates/page.liquid": "<h1>Page</h1>",
    "assets/css/theme.css": "body { color: red; }",
  };

  async function createMockThemeZip(
    files: Record<string, string | Buffer>,
  ): Promise<Buffer> {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) {
      zip.file(path, content);
    }
    return zip.generateAsync({ type: "nodebuffer" });
  }

  it("successfully extracts and validates a valid theme package", async () => {
    const zipBuffer = await createMockThemeZip(minimalValidFiles);
    const result = await validateAndExtractThemeZip(zipBuffer);

    expect(result.manifest.id).toBe("test-theme");
    expect(result.manifest.version).toBe("1.0.0");
    expect(result.files.has("theme.json")).toBe(true);
    expect(result.files.has("templates/home.liquid")).toBe(true);
    expect(result.files.has("assets/css/theme.css")).toBe(true);
  });

  it("handles theme with nested root directory correctly", async () => {
    const nestedFiles: Record<string, string | Buffer> = {};
    for (const [path, content] of Object.entries(minimalValidFiles)) {
      nestedFiles[`test-theme-1.0.0/${path}`] = content;
    }

    const zipBuffer = await createMockThemeZip(nestedFiles);
    const result = await validateAndExtractThemeZip(zipBuffer);

    expect(result.manifest.id).toBe("test-theme");
    expect(result.files.has("theme.json")).toBe(true);
    expect(result.files.has("templates/home.liquid")).toBe(true);
  });

  it("rejects non-zip files or corrupted zip", async () => {
    const invalidBuffer = Buffer.from("this is not a zip file at all");
    await expect(validateAndExtractThemeZip(invalidBuffer)).rejects.toThrow(
      /File is not a valid ZIP archive/i,
    );
  });

  it("rejects empty zip archive", async () => {
    const emptyBuffer = Buffer.alloc(0);
    await expect(validateAndExtractThemeZip(emptyBuffer)).rejects.toThrow(
      /Theme archive is empty/i,
    );
  });

  it("detects and rejects zip slip attacks (path traversal)", () => {
    expect(() => validateThemePath("../evil.css")).toThrow(ThemeZipError);
    expect(() => validateThemePath("/absolute/path.css")).toThrow(ThemeZipError);
    expect(() => validateThemePath("\\windows\\path.css")).toThrow(ThemeZipError);
    expect(() => validateThemePath("dir/../../evil.css")).toThrow(ThemeZipError);
    expect(() => validateThemePath("dir/null\0byte.css")).toThrow(ThemeZipError);
  });

  it("rejects forbidden executable and server code extensions (.ts, .tsx, .py, .sh, .js, .mjs, .cjs, .env)", async () => {
    const forbiddenFiles = [
      { ...minimalValidFiles, "server.ts": "export function run() {}" },
      { ...minimalValidFiles, "Component.tsx": "export const C = () => <div/>" },
      { ...minimalValidFiles, "script.sh": "#!/bin/sh\nrm -rf /" },
      { ...minimalValidFiles, "exploit.py": "import os; os.system('ls')" },
      { ...minimalValidFiles, "config.env": "SECRET=123" },
      { ...minimalValidFiles, "assets/js/theme.js": "console.log('hi');" },
      { ...minimalValidFiles, "assets/js/module.mjs": "export default 1;" },
      { ...minimalValidFiles, "assets/js/common.cjs": "module.exports = 1;" },
    ];

    for (const files of forbiddenFiles) {
      const zipBuffer = await createMockThemeZip(files);
      await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
        /prohibited executable or script file|not permitted/i,
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
      /is not permitted in Theme API v1 packages/i,
    );
  });

  it("rejects unsupported template file extensions (.hbs, .twig, etc.)", async () => {
    const handlebarsFiles = {
      ...minimalValidFiles,
      "templates/extra.hbs": "<div>{{title}}</div>",
    };
    const zipBuffer = await createMockThemeZip(handlebarsFiles);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /prohibited executable or script file|not permitted/i,
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

  it("rejects packages with missing declared previewImage", async () => {
    const missingPreview = {
      ...minimalValidFiles,
      "theme.json": JSON.stringify({
        id: "missing-preview-theme",
        name: "Missing Preview Theme",
        version: "1.0.0",
        themeApi: 1,
        previewImage: "nonexistent-preview.webp",
      }),
    };
    const zipBuffer = await createMockThemeZip(missingPreview);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /Declared previewImage "nonexistent-preview.webp" does not exist/i,
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
    const missingHome = {
      "theme.json": minimalValidFiles["theme.json"]!,
      "templates/post.liquid": "<h1>Post</h1>",
      "templates/page.liquid": "<h1>Page</h1>",
    };
    const zipBuffer = await createMockThemeZip(missingHome);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /missing required template files/i,
    );
  });

  it("rejects settings schema where a field has no default value", async () => {
    const invalidSettings = {
      ...minimalValidFiles,
      "settings.json": JSON.stringify({
        fields: [
          {
            key: "accentColor",
            type: "color",
            // missing default
          },
        ],
      }),
    };
    const zipBuffer = await createMockThemeZip(invalidSettings);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /missing mandatory default value/i,
    );
  });

  it("rejects select setting schema where default value is not among allowed options", async () => {
    const invalidSelect = {
      ...minimalValidFiles,
      "settings.json": JSON.stringify({
        fields: [
          {
            key: "layoutStyle",
            type: "select",
            options: ["grid", "list"],
            default: "masonry", // not in options
          },
        ],
      }),
    };
    const zipBuffer = await createMockThemeZip(invalidSelect);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /is not in allowed options/i,
    );
  });

  it("rejects select setting schema where options array is empty", async () => {
    const emptyOptions = {
      ...minimalValidFiles,
      "settings.json": JSON.stringify({
        fields: [
          {
            key: "layoutStyle",
            type: "select",
            options: [],
            default: "grid",
          },
        ],
      }),
    };
    const zipBuffer = await createMockThemeZip(emptyOptions);
    await expect(validateAndExtractThemeZip(zipBuffer)).rejects.toThrow(
      /must have a non-empty "options" array/i,
    );
  });
});
