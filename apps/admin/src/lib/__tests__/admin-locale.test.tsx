import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminLocaleProvider, useAdminLocale } from "../admin-locale";

describe("AdminLocale & Arabic UI Localization (LOC-004)", () => {
  beforeEach(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = "en";
      document.documentElement.dir = "ltr";
    }
  });

  function TestConsumer({ testKey, onContext }: { testKey?: string; onContext?: (ctx: ReturnType<typeof useAdminLocale>) => void }) {
    const ctx = useAdminLocale();
    if (onContext) onContext(ctx);
    return (
      <div data-testid="test-consumer">
        <span data-testid="locale">{ctx.locale}</span>
        {testKey && <span data-testid="tr">{ctx.tr(testKey)}</span>}
      </div>
    );
  }

  it("renders with default English locale in AdminLocaleProvider", () => {
    let captured: ReturnType<typeof useAdminLocale> | undefined;
    const html = renderToStaticMarkup(
      <AdminLocaleProvider>
        <TestConsumer testKey="Post Settings" onContext={(ctx) => { captured = ctx; }} />
      </AdminLocaleProvider>,
    );

    expect(html).toContain("Post Settings");
    expect(captured?.locale).toBe("en");
  });

  it("translates core editorial, settings, and media UI strings into Arabic via tr()", () => {
    let captured: ReturnType<typeof useAdminLocale> | undefined;
    renderToStaticMarkup(
      <AdminLocaleProvider initialLocale="ar-SA">
        <TestConsumer onContext={(ctx) => { captured = ctx; }} />
      </AdminLocaleProvider>,
    );

    expect(captured).toBeDefined();
    expect(captured!.locale).toBe("ar");

    // Test dictionary translations
    // Sidebar and Navigation
    expect(captured!.tr("Posts")).toBe("المقالات");
    expect(captured!.tr("Pages")).toBe("الصفحات");
    expect(captured!.tr("Tags")).toBe("الوسوم");
    expect(captured!.tr("Media Library")).toBe("مكتبة الوسائط");
    expect(captured!.tr("Settings")).toBe("الإعدادات");
    expect(captured!.tr("General Settings")).toBe("الإعدادات العامة");

    // Post Settings Sidebar
    expect(captured!.tr("Post Settings")).toBe("إعدادات المقال");
    expect(captured!.tr("Manage publication, metadata and SEO")).toBe("إدارة النشر والبيانات الوصفية ومحركات البحث");
    expect(captured!.tr("URL Slug")).toBe("معرّف الرابط");
    expect(captured!.tr("Excerpt")).toBe("المقتطف");
    expect(captured!.tr("Meta Data")).toBe("بيانات الميتا");
    expect(captured!.tr("Meta Title")).toBe("عنوان الميتا");
    expect(captured!.tr("Canonical URL")).toBe("الرابط الأساسي (Canonical)");
    expect(captured!.tr("Publish Date")).toBe("تاريخ النشر");
    expect(captured!.tr("Schedule")).toBe("جدولة");
    expect(captured!.tr("History")).toBe("السجل");
    expect(captured!.tr("Restore Version")).toBe("استعادة هذا الإصدار");

    // Page Settings Sidebar
    expect(captured!.tr("Page Settings")).toBe("إعدادات الصفحة");
    expect(captured!.tr("Manage static page configuration and SEO")).toBe("إدارة إعدادات الصفحة الثابتة ومحركات البحث");

    // Media Picker & Unsplash
    expect(captured!.tr("Select Media Asset")).toBe("اختيار وسائط");
    expect(captured!.tr("Choose existing media or upload new files")).toBe("اختر من الوسائط الحالية أو ارفع ملفات جديدة");
    expect(captured!.tr("Search filename...")).toBe("ابحث باسم الملف...");
    expect(captured!.tr("All Types")).toBe("جميع الأنواع");
    expect(captured!.tr("Upload File")).toBe("رفع ملف");
    expect(captured!.tr("Add feature image")).toBe("إضافة صورة مميزة");
    expect(captured!.tr("Unsplash Photo Library")).toBe("مكتبة صور Unsplash");
    expect(captured!.tr("Free")).toBe("مجاني");
  });

  it("formats dates, numbers, and relative times consistently", () => {
    let captured: ReturnType<typeof useAdminLocale> | undefined;
    renderToStaticMarkup(
      <AdminLocaleProvider>
        <TestConsumer onContext={(ctx) => { captured = ctx; }} />
      </AdminLocaleProvider>,
    );

    const testDate = new Date("2026-10-17T12:00:00Z");
    const enDate = captured!.formatDate(testDate);
    expect(enDate).toContain("2026");

    const enNum = captured!.formatNumber(12500);
    expect(enNum).toBe("12,500");

    // In Arabic
    let capturedAr: ReturnType<typeof useAdminLocale> | undefined;
    renderToStaticMarkup(
      <AdminLocaleProvider initialLocale="ar-SA">
        <TestConsumer onContext={(ctx) => { capturedAr = ctx; }} />
      </AdminLocaleProvider>,
    );
    const arDate = capturedAr!.formatDate(testDate);
    expect(arDate.length).toBeGreaterThan(0);

    const arNum = capturedAr!.formatNumber(12500);
    expect(arNum.length).toBeGreaterThan(0);
  });
});
