/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeNativeExtensionActionApi } from "../../../lib/api";
import { getActivePublicationId } from "../../../lib/api/client";
import { NativeExtensionActionForm } from "../NativeExtensionActionForm";

vi.mock("../../../lib/api", () => ({ executeNativeExtensionActionApi: vi.fn() }));
vi.mock("../../../lib/api/client", () => ({ getActivePublicationId: vi.fn() }));
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ locale: "en", tr: (key: string) => key }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const resource = {
  id: "courses", viewId: "overview",
  fields: ["title_en", "published"], fieldTypes: {
    title_en: "text" as const, published: "boolean" as const,
  },
  requiredFields: ["title_en"], textFilters: ["title_en"],
};
const actions = [
  { id: "create-course", resourceId: "courses", operation: "create" as const },
  { id: "update-course", resourceId: "courses", operation: "update" as const },
];
const hostile = "<script>alert(1)</script>";

describe("NUI-04 native action form", () => {
  let root: Root;
  let element: HTMLDivElement;
  const onSaved = vi.fn();
  const onClear = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getActivePublicationId).mockReturnValue("publication-a");
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => { root.unmount(); });
    element.remove();
  });
  async function render(selected: {
    id: string; version: number;
    fields: Readonly<Record<string, string | number | boolean | null>>;
  } | null = null) {
    await act(async () => {
      root.render(<NativeExtensionActionForm pluginId="sample-plugin"
        publicationId="publication-a" resource={resource} actions={actions}
        selected={selected} onSaved={onSaved} onClear={onClear} />);
    });
  }

  it("only exposes a create form after explicit user action; never sends on mount", async () => {
    await render();
    expect(executeNativeExtensionActionApi).not.toHaveBeenCalled();
    expect(element.querySelector("form")).toBeNull();
    const button = element.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Create record");
    await act(async () => { button?.click(); });
    expect(element.querySelector("form")).not.toBeNull();
    expect(element.querySelector<HTMLInputElement>("input[id$='-id']")?.required).toBe(true);
    expect(executeNativeExtensionActionApi).not.toHaveBeenCalled();
  });

  it("pre-populates CAS edits with escaped text and locks record identity", async () => {
    await render({ id: "course-1", version: 7, fields: {
      title_en: hostile, published: false,
    } });
    const id = element.querySelector<HTMLInputElement>("input[id$='-id']");
    expect(id?.value).toBe("course-1");
    expect(id?.disabled).toBe(true);
    expect(element.querySelector("script")).toBeNull();
    expect(element.querySelector<HTMLInputElement>("input[id$='-title_en']")?.value).toBe(hostile);
    expect(element.querySelector<HTMLSelectElement>("select[id$='-published']")?.value).toBe("false");
    expect(executeNativeExtensionActionApi).not.toHaveBeenCalled();
  });

  it("submits typed CAS values only after explicit confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(executeNativeExtensionActionApi).mockResolvedValue({
      schemaVersion: 1, record: {
        id: "course-1", version: 8, fields: { title_en: hostile, published: false },
      },
    });
    await render({ id: "course-1", version: 7, fields: {
      title_en: hostile, published: false,
    } });
    const form = element.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(confirm).toHaveBeenCalledWith("Confirm plugin record change?");
    expect(executeNativeExtensionActionApi).toHaveBeenCalledWith(
      "sample-plugin", "update-course",
      { id: "course-1", expectedVersion: 7,
        fields: { title_en: hostile, published: false } },
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("warns before abandoning a changed create draft but not an untouched draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    const create = element.querySelector<HTMLButtonElement>("button");
    await act(async () => { create?.click(); });
    const form = element.querySelector("form");
    const cancel = Array.from(form?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === "Cancel");
    await act(async () => { cancel?.click(); });
    expect(confirm).not.toHaveBeenCalled();
    expect(element.querySelector("form")).toBeNull();
    const restoredCreate = element.querySelector<HTMLButtonElement>("button");
    await act(async () => { restoredCreate?.click(); });
    const id = element.querySelector<HTMLInputElement>("input[id$='-id']");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      if (id && setter) setter.call(id, "draft-course");
      id?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const activeCancel = Array.from(element.querySelectorAll<HTMLButtonElement>("form button"))
      .find((button) => button.textContent === "Cancel");
    await act(async () => { activeCancel?.click(); });
    expect(confirm).toHaveBeenCalledWith("Discard unsaved plugin changes?");
    expect(element.querySelector("form")).not.toBeNull();
    confirm.mockReturnValue(true);
    await act(async () => { activeCancel?.click(); });
    expect(element.querySelector("form")).toBeNull();
    expect(executeNativeExtensionActionApi).not.toHaveBeenCalled();
  });

  it("does not send a mutation when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await render({ id: "course-1", version: 7, fields: { title_en: "Safe" } });
    const form = element.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(executeNativeExtensionActionApi).not.toHaveBeenCalled();
  });

  it("does not show prior-publication data after publication switch", async () => {
    await render({ id: "course-1", version: 1, fields: { title_en: hostile } });
    vi.mocked(getActivePublicationId).mockReturnValue("publication-b");
    await act(async () => { root.render(<NativeExtensionActionForm
      pluginId="sample-plugin" publicationId="publication-a"
      resource={resource} actions={actions} selected={null}
      onSaved={onSaved} onClear={onClear} />); });
    expect(element.textContent).not.toContain(hostile);
    expect(executeNativeExtensionActionApi).not.toHaveBeenCalled();
  });
});
