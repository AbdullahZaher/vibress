import { describe, expect, it } from "vitest";
import { isPublishedLmsCourse } from "./lms-course-policy";

const course = {
  outcome: "published",
  courseId: "web-101",
  title: "Web fundamentals",
  description: "Public summary",
  lessonTitle: "Preview",
};

describe("LMS public course publication boundary", () => {
  it("accepts a legacy published payload only with a verified Host-bound view", () => {
    expect(isPublishedLmsCourse(course, "web-101", "pub-a")).toBe(true);
    expect(isPublishedLmsCourse(course, "web-101", "")).toBe(false);
  });

  it("refuses a conflicting publication even if the course ID matches", () => {
    expect(isPublishedLmsCourse({ ...course, publicationId: "pub-b" }, "web-101", "pub-a")).toBe(false);
    expect(isPublishedLmsCourse({ ...course, publicationId: "pub-a" }, "web-101", "pub-a")).toBe(true);
  });

  it("refuses wrong IDs, unpublished content and invalid scalar shapes", () => {
    expect(isPublishedLmsCourse(course, "another", "pub-a")).toBe(false);
    expect(isPublishedLmsCourse({ ...course, outcome: "draft" }, "web-101", "pub-a")).toBe(false);
    expect(isPublishedLmsCourse({ ...course, description: { nested: true } }, "web-101", "pub-a")).toBe(false);
    expect(isPublishedLmsCourse(null, "web-101", "pub-a")).toBe(false);
  });
});
