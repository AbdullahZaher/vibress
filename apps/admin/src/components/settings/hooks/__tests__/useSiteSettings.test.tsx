/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteSettings } from "../useSiteSettings";
import { getStaffSettingsApi, updateSettingApi } from "../../../../lib/api/operations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../../lib/api/operations", () => ({
  getStaffSettingsApi: vi.fn(),
  updateSettingApi: vi.fn(),
}));

let latest: ReturnType<typeof useSiteSettings> | null = null;
function Harness() {
  latest = useSiteSettings();
  return <output data-testid="dirty">{latest.isDirty ? "dirty" : "clean"}</output>;
}

describe("site identity settings persistence", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.mocked(getStaffSettingsApi).mockResolvedValue({
      namespaces: [{
        namespace: "site",
        settings: [
          { key: "accentColor", value: "#123456", classification: "public" },
          { key: "iconUrl", value: "/icon.png", classification: "public" },
          { key: "logoUrl", value: "/logo.png", classification: "public" },
          { key: "coverUrl", value: "/cover.png", classification: "public" },
        ],
      }],
    });
    vi.mocked(updateSettingApi).mockResolvedValue({
      setting: { key: "logoUrl", value: "/new-logo.png", classification: "public" },
    });
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
  });
  afterEach(() => {
    act(() => root.unmount());
    node.remove();
    latest = null;
    vi.resetAllMocks();
  });

  it("retains identity assets and never sends legacy accent updates", async () => {
    await act(async () => root.render(<Harness />));
    expect(latest?.settings.logoUrl).toBe("/logo.png");
    expect(latest?.settings.iconUrl).toBe("/icon.png");
    expect(latest?.settings.coverUrl).toBe("/cover.png");
    expect(Object.keys(latest?.settings ?? {})).not.toContain("accentColor");
    await act(async () => latest?.updateField("logoUrl", "/new-logo.png"));
    expect(latest?.isDirty).toBe(true);
    await act(async () => { await latest?.save(); });
    expect(latest?.isDirty).toBe(false);
    expect(updateSettingApi).toHaveBeenCalledWith("site", "logoUrl", "/new-logo.png");
    expect(vi.mocked(updateSettingApi).mock.calls.some(([namespace, key]) =>
      namespace === "site" && key === "accentColor",
    )).toBe(false);
  });

  it("supports discarding unpublished icon changes", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => latest?.updateField("iconUrl", "/changed-icon.png"));
    expect(latest?.isDirty).toBe(true);
    act(() => latest?.discard());
    expect(latest?.settings.iconUrl).toBe("/icon.png");
    expect(latest?.isDirty).toBe(false);
    expect(updateSettingApi).not.toHaveBeenCalled();
  });
});
