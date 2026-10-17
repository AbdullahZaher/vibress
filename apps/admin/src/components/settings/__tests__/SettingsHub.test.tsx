/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsHub } from "../SettingsHub";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../hooks/useSettingsHub", () => ({
  useSettingsHub: () => ({
    general: {
      settings: {
        title: "Test",
        description: "",
        locale: "en",
        timezone: "UTC",
        isPrivate: false,
        password: "",
      },
      updateField: vi.fn(),
      isDirty: false,
      dirtyCount: 0,
    },
    site: {
      settings: {
        accentColor: "#000",
        brandColor: "#000",
        primaryNav: [],
        secondaryNav: [],
        socialLinks: [],
        announcementEnabled: false,
        announcementText: "",
        announcementUrl: "",
      },
      updateField: vi.fn(),
      isDirty: false,
      dirtyCount: 0,
    },
    membership: {
      settings: {
        signupEnabled: true,
        defaultNewsletterOptIn: true,
        memberSessionTtlHours: 24,
      },
      updateField: vi.fn(),
      isDirty: false,
      dirtyCount: 0,
    },
    growth: {
      settings: {},
      updateField: vi.fn(),
      isDirty: false,
      dirtyCount: 0,
    },
    advanced: {
      settings: {
        headerCode: "",
        footerCode: "",
      },
      updateField: vi.fn(),
      isDirty: false,
      dirtyCount: 0,
    },
    loading: false,
    saving: false,
    isDirty: false,
    dirtyCount: 0,
    globalSuccess: null,
    globalError: null,
    saveAllDirty: vi.fn(),
    discardAllDirty: vi.fn(),
  }),
}));

vi.mock("../hooks/useScrollSpy", () => ({
  useScrollSpy: () => ({
    activeSection: "advanced",
    scrollToSection: vi.fn(),
  }),
}));

describe("SettingsHub Advanced Pillar - Content Models", () => {
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
  });

  it("renders Content Models card row with an icon and navigates on manage click", async () => {
    const onNavigate = vi.fn();

    await act(async () => {
      root.render(<SettingsHub initialSection="advanced" can={() => true} onNavigate={onNavigate} />);
    });

    const contentModelsCard = container.querySelector("#advanced-content-models");
    expect(contentModelsCard).not.toBeNull();

    // Verify row title and description
    expect(contentModelsCard?.textContent).toContain("Content Models");
    expect(contentModelsCard?.textContent).toContain(
      "Define structured content types, fields, relations and their validation rules.",
    );

    // Verify the icon container is rendered
    const iconWrapper = contentModelsCard?.querySelector(".size-8.rounded-lg");
    expect(iconWrapper).not.toBeNull();

    // Verify SVG icon exists inside the wrapper
    const svgIcon = iconWrapper?.querySelector("svg");
    expect(svgIcon).not.toBeNull();
    expect(svgIcon?.getAttribute("class")).toContain("lucide-database");

    // Verify the action button
    const manageButton = contentModelsCard?.querySelector("button");
    expect(manageButton?.textContent).toContain("Manage models");

    await act(async () => {
      manageButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("/admin/settings/advanced/content-models");
  });
});
