import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getThemeSiteSettings } from "../../../lib/theme-host";
import { getDirection } from "@vibress/i18n";
import { getPublicExtensionPage, isValidPublicHost } from "../../../lib/public-extension-client";
import { isPublishedLmsCourse } from "../../../lib/lms-course-policy";
import { LmsStudentPortal } from "../../../components/extensions/LmsStudentPortal";

export const revalidate = 0;

type Props = {
  params: Promise<{ courseId: string }>;
};

async function fetchCourseData(
  courseId: string,
  locale: string,
  publicationId: string | undefined,
  incoming: Headers,
) {
  if (!publicationId) return null;
  // The linked public view carries the Host-authorized publication identity.
  // Existing signed LMS installs may omit publicationId in /course payloads,
  // so verify the view first and check an optional payload identity too.
  const view = await getPublicExtensionPage("vibress-lms-authoring", "catalog");
  if (!view || view.publicationId !== publicationId ||
      view.locale && view.locale !== locale ||
      view.publishedLocales && !view.publishedLocales.includes(locale)) return null;
  const host = incoming.get("host");
  if (!host || !isValidPublicHost(host)) return null;
  const apiBase = process.env.API_URL || "http://127.0.0.1:7780";
  const privateSiteCookie = incoming.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith("vb_site_auth="));

  try {
    const res = await fetch(
      apiBase + "/api/content/v1/extensions/vibress-lms-authoring/v1/course?courseId=" +
        encodeURIComponent(courseId) + "&locale=" + encodeURIComponent(locale),
      {
        headers: {
          "x-forwarded-host": host,
          ...(privateSiteCookie ? { cookie: privateSiteCookie } : {}),
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const value: unknown = await res.json();
    return isPublishedLmsCourse(value, courseId, publicationId) ? value : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { courseId } = await params;
  const site = await getThemeSiteSettings();
  const h = await headers();
  const course = await fetchCourseData(courseId, site.locale, site.publicationId, h);
  if (!course) return { title: "Course Not Found", robots: { index: false, follow: false } };
  return {
    title: `${course.title} — ${site.title || "Vibress"}`,
    description: course.description,
  };
}

export default async function CourseDetailPage({ params }: Props) {
  const { courseId } = await params;
  const site = await getThemeSiteSettings();
  const h = await headers();
  const course = await fetchCourseData(courseId, site.locale, site.publicationId, h);
  if (!course || !site.publicationId) notFound();

  const isArabic = site.locale.startsWith("ar");
  const direction = getDirection(site.locale);

  return (
    <main
      id="main-content"
      dir={direction}
      style={{
        maxWidth: "64rem",
        marginInline: "auto",
        padding: "clamp(1.5rem, 4vw, 3.5rem)",
        color: "inherit",
      }}
    >
      <nav style={{ marginBottom: "1.5rem" }}>
        <a
          href="/courses"
          style={{
            color: "#2563eb",
            textDecoration: "none",
            fontWeight: 500,
            fontSize: "0.95rem",
          }}
        >
          {isArabic ? "← العودة إلى دليل الدورات" : "← Back to Course Catalog"}
        </a>
      </nav>

      <header style={{ marginBottom: "2rem", borderBottom: "1px solid rgba(128,128,128,0.2)", paddingBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0.2rem 0.5rem",
              borderRadius: "9999px",
              background: "#dcfce7",
              color: "#166534",
            }}
          >
            {isArabic ? "دورة منشورة" : "Published Course"}
          </span>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }} dir="ltr">
            {course.courseId}
          </span>
        </div>

        <h1 style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)", margin: "0.25rem 0 0.75rem 0", lineHeight: 1.25 }}>
          {course.title}
        </h1>

        <p style={{ fontSize: "1.1rem", opacity: 0.85, margin: 0, maxWidth: "48rem" }}>
          {course.description}
        </p>
      </header>

      {/* Curriculum & Learner Portal Section */}
      <section style={{ display: "grid", gap: "1.5rem", marginBottom: "3rem" }}>
        <div
          style={{
            border: "1px solid rgba(128,128,128,0.2)",
            borderRadius: "0.75rem",
            padding: "1.5rem",
            background: "rgba(128,128,128,0.03)",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", margin: "0 0 1rem 0" }}>
            {isArabic ? "منهج الدورة التعليمي" : "Course Curriculum"}
          </h2>
          <ul style={{ margin: 0, paddingInlineStart: "1.25rem" }}>
            <li style={{ fontSize: "1rem", fontWeight: 500 }}>
              {course.lessonTitle}
            </li>
          </ul>
        </div>

        {/* First-party learner experience: no same-origin sandbox escape. */}
        <div
          style={{
            border: "1px solid rgba(128,128,128,0.2)",
            borderRadius: "0.75rem",
            overflow: "hidden",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
          }}
        >
          <LmsStudentPortal courseId={course.courseId}
            publicationId={site.publicationId} locale={site.locale} />
        </div>
      </section>
    </main>
  );
}
