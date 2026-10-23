import type { ThemeExtensionViewModel } from "@vibress/theme-core";

interface CatalogCourseItem {
  id: string;
  title: string;
  description: string;
  lessonTitle: string;
}

/**
 * Every theme has a safe fallback. Plugin-provided values remain text nodes,
 * never HTML, CSS, URLs, or script instructions.
 * Specialized catalog projection for LMS course cards while preserving
 * generic dictionary fallback for all other extension views.
 */
export function DefaultExtensionView({ extension }: {
  extension: ThemeExtensionViewModel;
}) {
  const isCatalog = extension.viewId === "catalog" || typeof extension.data.catalogJson === "string";
  const isArabic = extension.locale?.startsWith("ar");

  let courses: CatalogCourseItem[] = [];
  if (isCatalog) {
    if (typeof extension.data.catalogJson === "string") {
      try {
        courses = JSON.parse(extension.data.catalogJson);
      } catch {
        courses = [];
      }
    }
    if (courses.length === 0 && extension.data.courseId && extension.data.outcome === "published") {
      courses = [{
        id: String(extension.data.courseId),
        title: String(extension.data.title || extension.data.courseId),
        description: String(extension.data.description || ""),
        lessonTitle: String(extension.data.lessonTitle || (isArabic ? "درس متاح" : "1 Lesson Available")),
      }];
    }
  }

  if (isCatalog) {
    return (
      <main id="main-content" aria-label={extension.title}
        dir={extension.direction}
        className="vibress-extension-view vibress-courses-catalog"
        style={{
          maxWidth: "72rem",
          marginInline: "auto",
          padding: "clamp(1rem, 4vw, 3rem)",
          color: "inherit",
        }}>
        <header style={{ marginBlockEnd: "2.5rem", borderBottom: "1px solid rgba(128,128,128,0.2)", paddingBottom: "1.5rem" }}>
          <span style={{
            display: "inline-block",
            fontSize: "0.8rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            background: "rgba(37,99,235,0.1)",
            color: "#2563eb",
            marginBottom: "0.75rem",
          }}>
            {isArabic ? "نظام إدارة التعلّم" : "Learning Management"}
          </span>
          <h1 dir="auto" style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", margin: "0.25rem 0 0.5rem 0" }}>
            {extension.title}
          </h1>
          <p dir="auto" style={{ opacity: 0.8, fontSize: "1.05rem", margin: 0, maxWidth: "42rem" }}>
            {isArabic
              ? "استعرض الدورات التدريبية المتاحة وسجّل للبدء في تعلّم المهارات الحديثة."
              : "Explore available courses, preview curricula, and enroll to begin learning."}
          </p>
        </header>

        {courses.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "3rem 1.5rem",
            border: "1px dashed rgba(128,128,128,0.3)",
            borderRadius: "0.75rem",
          }}>
            <p style={{ fontWeight: 600, fontSize: "1.1rem", margin: 0 }}>
              {isArabic ? "لا توجد دورات منشورة حاليًا." : "No published courses available yet."}
            </p>
            <p style={{ opacity: 0.75, fontSize: "0.9rem", marginTop: "0.5rem" }}>
              {isArabic ? "يرجى التحقق لاحقًا للمزيد من المحتوى التعليمي." : "Please check back soon for upcoming learning materials."}
            </p>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(19rem, 1fr))",
            gap: "1.5rem",
          }}>
            {courses.map((course) => (
              <article key={course.id} style={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid rgba(128,128,128,0.2)",
                borderRadius: "0.75rem",
                padding: "1.5rem",
                background: "rgba(128,128,128,0.03)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                transition: "box-shadow 0.2s ease, transform 0.2s ease",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <span style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    padding: "0.2rem 0.5rem",
                    borderRadius: "9999px",
                    background: "#dcfce7",
                    color: "#166534",
                  }}>
                    {isArabic ? "منشور" : "Published"}
                  </span>
                  <span style={{ fontSize: "0.8rem", opacity: 0.7 }} dir="ltr">
                    {course.id}
                  </span>
                </div>

                <h2 dir="auto" style={{ fontSize: "1.25rem", margin: "0 0 0.5rem 0", lineHeight: 1.3 }}>
                  {course.title}
                </h2>

                <p dir="auto" style={{
                  fontSize: "0.95rem",
                  opacity: 0.85,
                  margin: "0 0 1.25rem 0",
                  flex: 1,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {course.description}
                </p>

                <div style={{
                  padding: "0.75rem 1rem",
                  background: "rgba(128,128,128,0.06)",
                  borderRadius: "0.5rem",
                  marginBottom: "1.25rem",
                  fontSize: "0.85rem",
                }}>
                  <strong style={{ display: "block", marginBottom: "0.25rem" }}>
                    {isArabic ? "معاينة المنهج:" : "Curriculum Preview:"}
                  </strong>
                  <span dir="auto" style={{ opacity: 0.9 }}>
                    • {course.lessonTitle}
                  </span>
                </div>

                <div style={{ marginTop: "auto" }}>
                  <a
                    href={`/courses/${encodeURIComponent(course.id)}`}
                    style={{
                      display: "block",
                      textAlign: "center",
                      padding: "0.65rem 1.25rem",
                      borderRadius: "0.5rem",
                      background: "#2563eb",
                      color: "#ffffff",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      textDecoration: "none",
                    }}
                  >
                    {isArabic ? "التسجيل وبدء التعلّم ←" : "Enroll & Start Learning →"}
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    );
  }

  return (
    <main id="main-content" aria-label={extension.title}
      dir={extension.direction}
      className="vibress-extension-view"
      style={{ maxWidth: "72rem", marginInline: "auto",
        padding: "clamp(1rem, 4vw, 3rem)" }}>
      <header style={{ marginBlockEnd: "2rem" }}>
        <h1 dir="auto">{extension.title}</h1>
      </header>
      <dl style={{ display: "grid", gap: "1rem" }}>
        {Object.entries(extension.data).map(([key, value]) => (
          <div key={key}>
            <dt dir="auto" style={{ fontWeight: 600 }}>{key}</dt>
            <dd dir="auto" style={{ overflowWrap: "anywhere", marginInlineStart: 0 }}>
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
