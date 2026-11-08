/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLocaleProvider } from "../../../lib/admin-locale";
import {
  createExportApi,
  createImportApi,
  validateImportApi,
} from "../../../lib/api/operations";
import { ImportExportCard } from "../advanced/ImportExportCard";
import { SETTINGS_REGISTRY } from "../settings.registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../lib/api/operations", { spy: true });

const job = {
  id: "fixture",
  requestedBy: null,
  progress: 100,
  errorSummary: null,
  artifactKey: null,
  createdAt: "2026-11-08T00:00:00Z",
};

describe("Admin import and export scope", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.removeItem("vibress-admin-ui-locale");
    vi.resetAllMocks();
  });

  function button(label: string): HTMLButtonElement {
    const match = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === label,
    );
    if (!match) throw new Error(`Button not found: ${label}`);
    return match;
  }

  it("matches Settings search, describes native JSON, and retains job operations", async () => {
    const entry = SETTINGS_REGISTRY.flatMap((pillar) => pillar.cards).find(
      (card) => card.id === "import-export",
    );
    expect(entry).toMatchObject({
      title: "Import and export settings and redirects",
      description: "Transfer supported publication settings and redirects using Vibress JSON.",
      keywords: ["import", "export", "settings", "redirects", "json"],
    });
    act(() => root.render(<ImportExportCard />));
    expect(container.textContent).toContain(entry?.description);
    act(() => button("Open tools").click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Only supported settings and redirects are imported.");
    expect(dialog?.textContent).toContain("Secrets are excluded.");
    expect(dialog?.textContent).not.toMatch(/all content|Ghost|WordPress|Substack|Universal Import/);

    vi.mocked(createExportApi).mockResolvedValue({
      job: { ...job, type: "export", status: "completed" },
    });
    await act(async () => button("Create export").click());
    expect(createExportApi).toHaveBeenCalledOnce();
    expect(dialog?.textContent).toContain("Export job created (Job ID: fixture).");

    const envelope = { format: "vibress", version: 1, data: { redirects: [] } };
    const input = dialog?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Import file input not found");
    expect(input.accept).toBe(".json");
    const chooser = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => button("Choose JSON file").click());
    expect(chooser).toHaveBeenCalledOnce();
    const file = new File([], "settings.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(envelope) });
    Object.defineProperty(input, "files", { value: [file] });
    vi.mocked(validateImportApi).mockResolvedValue({ valid: true });
    vi.mocked(createImportApi).mockResolvedValue({
      job: { ...job, type: "import", status: "failed" },
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(validateImportApi).toHaveBeenCalledWith(envelope);
    expect(createImportApi).toHaveBeenCalledWith(envelope);
    expect(dialog?.textContent).toContain("Import failed (Job ID: fixture).");
  });

  it("presents the same scope in Arabic", () => {
    window.localStorage.setItem("vibress-admin-ui-locale", "ar");
    act(() => root.render(
      <AdminLocaleProvider>
        <ImportExportCard />
      </AdminLocaleProvider>,
    ));
    expect(container.textContent).toContain("استيراد وتصدير الإعدادات وإعادات التوجيه");
    act(() => button("فتح الأدوات").click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("يقتصر الاستيراد على الإعدادات وإعادات التوجيه المدعومة.");
    expect(button("اختيار ملف JSON")).toBeDefined();
  });
});
