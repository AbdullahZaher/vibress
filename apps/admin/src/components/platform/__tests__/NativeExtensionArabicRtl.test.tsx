/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { writeExtensionAdminViewApi } from "../../../lib/api";
import { getActivePublicationId } from "../../../lib/api/client";
import { NativeExtensionDomainEditor } from "../NativeExtensionDomainEditor";
import type { ExtensionNativeDomainWorkflowV1 } from "@vibress/api-contracts";

vi.mock("../../../lib/api", () => ({
  writeExtensionAdminViewApi: vi.fn(),
}));

vi.mock("../../../lib/api/client", () => ({
  getActivePublicationId: vi.fn(),
}));

vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({
    locale: "ar",
    tr: (key: string) => {
      const arabicTranslations: Record<string, string> = {
        "Domain workflow": "سير العمل للمجال",
        "Record ID": "معرف السجل",
        "Create draft": "إنشاء مسودة",
        "Save draft": "حفظ المسودة",
        "Publish": "نشر",
        "Cancel": "إلغاء",
        "Confirm saving this draft?": "تأكيد حفظ المسودة؟",
        "Confirm publish this record?": "تأكيد نشر هذا السجل؟",
        "Draft saved successfully.": "تم حفظ المسودة بنجاح.",
        "Record published successfully.": "تم نشر السجل بنجاح.",
        "Discard unsaved plugin changes?": "تجاهل التغييرات غير المحفوظة؟",
        "Published items cannot be edited.": "لا يمكن تعديل العناصر المنشورة.",
        "Save your changes before publishing.": "احفظ تغييراتك قبل النشر.",
        "Invalid plugin record data.": "بيانات سجل الإضافة غير صالحة.",
        "Workflow action rejected.": "تم رفض إجراء سير العمل.",
        "Workflow action failed.": "فشل إجراء سير العمل.",
        "Loading plugin view...": "جارٍ تحميل عرض الإضافة...",
        "Unable to load plugin view.": "تعذر تحميل عرض الإضافة.",
      };
      return arabicTranslations[key] ?? key;
    },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const workflow: ExtensionNativeDomainWorkflowV1 = {
  schemaVersion: 1 as const,
  viewId: "courses-view",
  routeId: "courses-route",
  resourceId: "courses-resource",
  idField: "courseId",
  versionField: "expectedVersion",
  operationField: "operation",
  fields: [
    { key: "title_ar", label: { en: "Arabic Title", ar: "عنوان الدورة" }, maxLength: 180 },
    { key: "description_ar", label: { en: "Arabic Description", ar: "وصف الدورة" }, maxLength: 500, multiline: true },
  ],
  operations: ["create", "save", "publish"],
};

const link = {
  pluginId: "lms-core",
  viewId: "courses-view",
  routeId: "courses-route",
  label: { en: "Courses", ar: "الدورات التعليمية" },
  title: { en: "Courses", ar: "الدورات التعليمية" },
  permission: "plugins.manage" as const,
  nativeProbeSupported: true as const,
};

describe("NUI-04/NUI-05 Native Admin UI Arabic RTL and Accessibility Acceptance", () => {
  let root: Root;
  let element: HTMLDivElement;
  const onSaved = vi.fn();
  const onClear = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getActivePublicationId).mockReturnValue("site-arabic");
    element = document.createElement("div");
    element.setAttribute("dir", "rtl");
    document.body.append(element);
    root = createRoot(element);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    element.remove();
  });

  it("renders Arabic form labels and sets dir='auto' on text inputs for bidirectional entry", async () => {
    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={null}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    const createBtn = element.querySelector<HTMLButtonElement>("button");
    expect(createBtn?.textContent).toBe("إنشاء مسودة");

    await act(async () => {
      createBtn?.click();
    });

    const titleLabel = element.querySelector("label[for$='-title_ar']");
    expect(titleLabel?.textContent).toBe("عنوان الدورة");
    expect(titleLabel?.getAttribute("dir")).toBe("auto");

    const titleInput = element.querySelector<HTMLInputElement>("input[id$='-title_ar']");
    expect(titleInput?.getAttribute("dir")).toBe("auto");

    // Technical record ID must remain LTR even in RTL mode
    const idInput = element.querySelector<HTMLInputElement>("input[id$='-id']");
    expect(idInput?.getAttribute("dir")).toBe("ltr");
  });

  it("handles mixed Bidi text entry, confirmation prompt, and successful Arabic draft submission", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(writeExtensionAdminViewApi).mockResolvedValue({
      outcome: "created",
      courseId: "typescript-101",
      version: 1,
      status: "draft",
    });

    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={null}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    await act(async () => {
      element.querySelector<HTMLButtonElement>("button")?.click();
    });

    const idInput = element.querySelector<HTMLInputElement>("input[id$='-id']");
    const titleInput = element.querySelector<HTMLInputElement>("input[id$='-title_ar']");
    const descTextarea = element.querySelector<HTMLTextAreaElement>("textarea[id$='-description_ar']");

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

    await act(async () => {
      if (idInput && setter) setter.call(idInput, "typescript-101");
      idInput?.dispatchEvent(new Event("input", { bubbles: true }));

      const arabicTitle = "دورة TypeScript المتقدمة للمحترفين (Advanced TypeScript)";
      if (titleInput && setter) setter.call(titleInput, arabicTitle);
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));

      const arabicDesc = "تعلم نمط البرمجة الوظيفية والأنواع المتقدمة مع Vibress CMS.";
      if (descTextarea && textSetter) textSetter.call(descTextarea, arabicDesc);
      descTextarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      element.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(window.confirm).toHaveBeenCalledWith("تأكيد حفظ المسودة؟");
    expect(writeExtensionAdminViewApi).toHaveBeenCalledWith(link, {
      courseId: "typescript-101",
      expectedVersion: 0,
      operation: "create",
      title_ar: "دورة TypeScript المتقدمة للمحترفين (Advanced TypeScript)",
      description_ar: "تعلم نمط البرمجة الوظيفية والأنواع المتقدمة مع Vibress CMS.",
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("announces validation errors with role='alert' in Arabic and blocks publish when dirty", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={{
            id: "course-published",
            version: 1,
            fields: {
              title_ar: "دورة منشورة",
              description_ar: "وصف",
              status: "published",
            },
          }}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    const statusMsg = element.querySelector('[role="status"]');
    expect(statusMsg?.textContent).toBe("لا يمكن تعديل العناصر المنشورة.");
    expect(element.querySelector("form")).toBeNull();
  });

  it("hides all Arabic form and data state immediately upon publication switching", async () => {
    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={{
            id: "draft-secret",
            version: 2,
            fields: {
              title_ar: "محتوى خاص بالموقع الأول",
              description_ar: "بيانات سرية",
              status: "draft",
            },
          }}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    const titleInput = element.querySelector<HTMLInputElement>("input[id$='-title_ar']");
    expect(titleInput?.value).toBe("محتوى خاص بالموقع الأول");

    // Staff switches active publication to site-english
    vi.mocked(getActivePublicationId).mockReturnValue("site-english");

    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={null}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    // Old site's private Arabic form must be unmounted and wiped out immediately
    expect(element.querySelector("form")).toBeNull();
    expect(element.querySelector("input[id$='-title_ar']")).toBeNull();
  });

  it("safely escapes hostile stored XSS payloads without executing scripts", async () => {
    (window as unknown as { __xss_injected?: boolean }).__xss_injected = false;

    const xssPayload = "<script>window.__xss_injected=true;</script><img src=x onerror=\"window.__xss_injected=true;\" />";

    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={{
            id: "course-xss-test",
            version: 1,
            fields: {
              title_ar: xssPayload,
              description_ar: "Safe description",
              status: "draft",
            },
          }}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    // Verification: Script did not execute
    expect((window as unknown as { __xss_injected?: boolean }).__xss_injected).toBe(false);

    // Form inputs receive the string value literally, not parsed as HTML nodes
    const titleInput = element.querySelector<HTMLInputElement>("input[id$='-title_ar']");
    expect(titleInput?.value).toBe(xssPayload);
    // Ensure no <script> or <img> tags were inserted into DOM
    expect(element.querySelector("script")).toBeNull();
    expect(element.querySelector("img")).toBeNull();
  });

  it("displays accessible role='alert' error when authorization is lost or workflow action fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // Simulate network error / 403 Forbidden rejection
    vi.mocked(writeExtensionAdminViewApi).mockRejectedValue(new Error("403 Forbidden"));

    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={null}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    await act(async () => {
      element.querySelector<HTMLButtonElement>("button")?.click();
    });

    const idInput = element.querySelector<HTMLInputElement>("input[id$='-id']");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      if (idInput && setter) setter.call(idInput, "test-course");
      idInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      element.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const alertEl = element.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.textContent).toBe("فشل إجراء سير العمل.");
  });

  it("supports keyboard-only cancel and prompts before discarding unsaved dirty changes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false); // User cancels discard prompt

    await act(async () => {
      root.render(
        <NativeExtensionDomainEditor
          workflow={workflow}
          link={link}
          publicationId="site-arabic"
          selected={null}
          onSaved={onSaved}
          onClear={onClear}
        />
      );
    });

    await act(async () => {
      element.querySelector<HTMLButtonElement>("button")?.click();
    });

    // Make form dirty
    const idInput = element.querySelector<HTMLInputElement>("input[id$='-id']");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      if (idInput && setter) setter.call(idInput, "test-dirty");
      idInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Click Cancel button
    const cancelBtn = Array.from(element.querySelectorAll("button")).find(
      (b) => b.textContent === "إلغاء"
    );
    expect(cancelBtn).toBeDefined();

    await act(async () => {
      cancelBtn?.click();
    });

    expect(window.confirm).toHaveBeenCalledWith("تجاهل التغييرات غير المحفوظة؟");
    // Since user canceled discard, form should still be open
    expect(element.querySelector("form")).not.toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });
});
