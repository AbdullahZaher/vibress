import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThemeExtensionViewModel } from "@vibress/theme-core";
import { DefaultExtensionView } from "./DefaultExtensionView";

const base: ThemeExtensionViewModel = {
  pluginId: "vibress-lms-authoring",
  viewId: "catalog",
  title: "Courses",
  locale: "en",
  direction: "ltr",
  data: {},
};

function render(extension: ThemeExtensionViewModel): string {
  return renderToStaticMarkup(<DefaultExtensionView extension={extension} />);
}

describe("DefaultExtensionView LMS catalog fallback", () => {
  it("renders validated course cards with text-only content", () => {
    const markup = render({
      ...base,
      data: {
        catalogJson: JSON.stringify([{
          id: "web-101",
          title: "<script>alert(1)</script>",
          description: "Introductory course",
          lessonTitle: "Welcome",
        }]),
      },
    });
    expect(markup).toContain("/courses/web-101");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("does not hijack another plugin's catalog view", () => {
    const markup = render({
      ...base,
      pluginId: "some-other-extension",
      data: { catalogJson: "[]", info: "Independent plugin output" },
    });
    expect(markup).toContain("Independent plugin output");
    expect(markup).not.toContain("Learning Management");
  });

  it("rejects malformed catalog entries without crashing the renderer", () => {
    const markup = render({
      ...base,
      locale: "ar",
      direction: "rtl",
      title: "الدورات",
      data: { catalogJson: JSON.stringify([null, { id: "missing-fields" }, 42]) },
    });
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain("لا توجد دورات منشورة");
    expect(markup).not.toContain("/courses/missing-fields");

    const nonArray = render({ ...base, data: { catalogJson: '{"id":"bad-shape"}' } });
    expect(nonArray).toContain("No published courses available");
  });
});
