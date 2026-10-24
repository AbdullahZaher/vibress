/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LmsStudentPortal } from "./LmsStudentPortal";

const courseId = "test-course";
const publicationId = "publication-a";
const course = {
  outcome: "published", courseId, publicationId, locale: "en",
  title: "Course <script>unsafe</script>", description: "Course summary",
  lessonTitle: "Welcome",
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

describe("LMS first-party student interaction", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("enrolls, displays a protected lesson as text and completes progress", async () => {
    let enrolled = false;
    let completed = false;
    const requests: { url: string; method: string; credentials?: RequestCredentials }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      const method = options?.method ?? "GET";
      requests.push({
        url, method,
        ...(options?.credentials ? { credentials: options.credentials } : {}),
      });
      if (url.includes("/v1/course?")) return reply(course);
      if (url.includes("/v1/progress?")) {
        return enrolled
          ? reply({ outcome: "available", percent: completed ? 100 : 0 })
          : reply({ outcome: "not-enrolled" }, 404);
      }
      if (url.includes("/v1/lesson?")) return enrolled
        ? reply({ outcome: "allowed", title: "First lesson", body: "<img onerror=alert(1)>" })
        : reply({ outcome: "not-found", title: "", body: "" }, 404);
      if (url.endsWith("/v1/enroll") && method === "POST") {
        enrolled = true;
        return reply({ outcome: "created", courseId });
      }
      if (url.endsWith("/v1/complete") && method === "POST") {
        completed = true;
        return reply({ outcome: "completed", lessonId: "lesson" });
      }
      throw new Error("Unexpected route: " + url);
    }));

    await act(async () => {
      root.render(<LmsStudentPortal courseId={courseId}
        publicationId={publicationId} locale="en" />);
    });
    expect(container.textContent).toContain("Enroll in course");
    expect(container.innerHTML).toContain("&lt;script&gt;unsafe&lt;/script&gt;");

    await act(async () => {
      const button = [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Enroll in course");
      expect(button).toBeDefined();
      button?.click();
    });
    expect(container.textContent).toContain("You are enrolled in this course");
    expect(container.textContent).toContain("<img onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("0%");

    await act(async () => {
      const button = [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Mark lesson complete");
      expect(button).toBeDefined();
      button?.click();
    });
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("Completed");
    expect(requests.filter((request) => request.method === "POST")).toEqual([
      expect.objectContaining({ url: expect.stringContaining("/v1/enroll"), credentials: "same-origin" }),
      expect.objectContaining({ url: expect.stringContaining("/v1/complete"), credentials: "same-origin" }),
    ]);
  });

  it("never displays enrollment controls for a course belonging to another publication", async () => {
    const fetchMock = vi.fn(async () =>
      reply({ ...course, publicationId: "publication-b" }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<LmsStudentPortal courseId={courseId}
        publicationId={publicationId} locale="ar-SA" />);
    });
    expect(container.textContent).toContain("الدورة غير متاحة");
    expect(container.querySelector("button")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("section")?.getAttribute("dir")).toBe("rtl");
  });
});
