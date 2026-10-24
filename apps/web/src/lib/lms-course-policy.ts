/** Publish-only, tenant-bound projection of the LMS public course detail.
 * Older installed LMS releases may omit publicationId; the caller must
 * independently verify the Host-bound public view's publicationId. */
export interface PublishedLmsCourse {
  readonly outcome: "published";
  readonly courseId: string;
  readonly title: string;
  readonly description: string;
  readonly lessonTitle: string;
  readonly publicationId?: string;
}

export function isPublishedLmsCourse(
  value: unknown,
  courseId: string,
  publicationId: string,
): value is PublishedLmsCourse {
  if (!publicationId || !value || typeof value !== "object") return false;
  const course = value as Record<string, unknown>;
  return course.outcome === "published" &&
    course.courseId === courseId &&
    typeof course.title === "string" &&
    typeof course.description === "string" &&
    typeof course.lessonTitle === "string" &&
    (course.publicationId === undefined || course.publicationId === publicationId);
}
