"use client";

import { useEffect, useState } from "react";
import { isPublishedLmsCourse, type PublishedLmsCourse } from "../../lib/lms-course-policy";

type Action = "enroll" | "complete";
type Progress = { readonly outcome: string; readonly percent: number };
type Lesson = { readonly outcome: string; readonly title: string; readonly body: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok) return null;
  try { return object(await response.json()); } catch { return null; }
}

/**
 * First-party Member UI. The former same-origin iframe could combine
 * allow-scripts and allow-same-origin; no executable plugin HTML is embedded.
 * All reads/writes retain the existing Host-bound Member cookie and Origin
 * checks, including on private sites.
 */
export function LmsStudentPortal({ courseId, publicationId, locale }: {
  courseId: string;
  publicationId: string;
  locale: string;
}) {
  const arabic = locale.toLowerCase().startsWith("ar");
  const [course, setCourse] = useState<PublishedLmsCourse | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [percent, setPercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const courseQuery = encodeURIComponent(courseId) + "&locale=" + encodeURIComponent(locale);
    const init = { credentials: "same-origin" as const, signal: controller.signal };
    async function load() {
      setLoading(true);
      setCourse(null);
      setLesson(null);
      setEnrolled(false);
      setPercent(0);
      try {
        const publicResponse = await fetch(
          "/api/content/v1/extensions/vibress-lms-authoring/v1/course?courseId=" + courseQuery,
          init,
        );
        const published = await readJson(publicResponse);
        if (!active) return;
        if (!isPublishedLmsCourse(published, courseId, publicationId)) {
          setNotice(arabic ? "الدورة غير متاحة" : "Course is unavailable");
          return;
        }
        setCourse(published);
        const progressResponse = await fetch(
          "/api/members/v1/extensions/vibress-lms-authoring/v1/progress?courseId=" +
            encodeURIComponent(courseId), init,
        );
        const progress = await readJson(progressResponse);
        if (!active || progress?.outcome !== "available" ||
            typeof progress.percent !== "number" ||
            !Number.isFinite(progress.percent)) return;
        const safeProgress: Progress = {
          outcome: "available", percent: Math.max(0, Math.min(100, progress.percent)),
        };
        setEnrolled(true);
        setPercent(safeProgress.percent);
        const lessonResponse = await fetch(
          "/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=" + courseQuery,
          init,
        );
        const result = await readJson(lessonResponse);
        if (active && result?.outcome === "allowed" &&
            typeof result.title === "string" && typeof result.body === "string") {
          setLesson({ outcome: "allowed", title: result.title, body: result.body });
        }
      } catch {
        if (active) setNotice(arabic ? "تعذر تحميل الدورة" : "Unable to load course");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [courseId, publicationId, locale, revision, arabic]);

  async function perform(action: Action) {
    if (!course || busy || (action === "enroll" && enrolled) ||
        (action === "complete" && (!enrolled || percent === 100))) return;
    setBusy(action);
    setNotice("");
    try {
      const response = await fetch(
        "/api/members/v1/extensions/vibress-lms-authoring/v1/" + action,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId, locale }),
        },
      );
      const result = await readJson(response);
      const accepted = action === "enroll"
        ? result?.outcome === "created" || result?.outcome === "already-enrolled"
        : result?.outcome === "completed" || result?.outcome === "already-completed";
      if (accepted) {
        setNotice(action === "enroll"
          ? (arabic ? "تم التسجيل بنجاح" : "Enrolled successfully")
          : (arabic ? "تم إكمال الدرس" : "Lesson completed"));
        setRevision((value) => value + 1);
      } else {
        setNotice(response.status === 401
          ? (arabic ? "سجّل الدخول للمتابعة" : "Sign in to continue")
          : (arabic ? "تعذر إتمام العملية" : "Unable to complete request"));
      }
    } catch {
      setNotice(arabic ? "خطأ في الاتصال" : "Connection error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label={arabic ? "بوابة الطالب" : "Student portal"} dir={arabic ? "rtl" : "ltr"}
      style={{ padding: "clamp(1rem, 3vw, 2rem)", display: "grid", gap: "1rem" }}>
      <h2 style={{ margin: 0 }}>{arabic ? "التعلم والتقدم" : "Learning and progress"}</h2>
      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {notice || (loading ? (arabic ? "جارٍ التحميل…" : "Loading…") : "")}
      </p>
      {course && (
        <>
          <h3 dir="auto" style={{ margin: 0 }}>{course.title}</h3>
          <p dir="auto" style={{ margin: 0 }}>{course.description}</p>
          {!enrolled ? (
            <button type="button" disabled={loading || busy !== null}
              onClick={() => { void perform("enroll"); }}>
              {arabic ? "التسجيل في الدورة" : "Enroll in course"}
            </button>
          ) : (
            <>
              <p>{arabic ? "أنت مسجل في هذه الدورة" : "You are enrolled in this course"}</p>
              <label htmlFor="lms-progress">{arabic ? "نسبة الإكمال" : "Completion progress"}</label>
              <progress id="lms-progress" max={100} value={percent} style={{ width: "100%" }} />
              <p>{percent}%</p>
              {lesson && (
                <section aria-label={arabic ? "الدرس المحمي" : "Protected lesson"}>
                  <h4 dir="auto">{lesson.title}</h4>
                  <p dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {lesson.body}
                  </p>
                </section>
              )}
              <button type="button" disabled={loading || busy !== null || percent === 100}
                onClick={() => { void perform("complete"); }}>
                {percent === 100
                  ? (arabic ? "مكتمل" : "Completed")
                  : (arabic ? "إكمال الدرس" : "Mark lesson complete")}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
