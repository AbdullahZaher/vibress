import { describe, it, expect } from "vitest";
import { assertJobScope } from "@vibress/queue";

describe("Worker Job Scope Enforcement", () => {
  it("accepts valid publication-scoped jobs", () => {
    const scope = assertJobScope({
      scope: "publication",
      publicationId: "pub_alpha",
      sendId: "send-1",
    });
    expect(scope).toEqual({ scope: "publication", publicationId: "pub_alpha" });
  });

  it("accepts valid system-scoped jobs", () => {
    const scope = assertJobScope({
      scope: "system",
      op: "rebuild",
    });
    expect(scope).toEqual({ scope: "system" });
  });

  it("extracts publicationId from nested doc if present", () => {
    const scope = assertJobScope({
      scope: "publication",
      doc: { publicationId: "pub_beta", entityId: "post-1" },
    });
    expect(scope).toEqual({ scope: "publication", publicationId: "pub_beta" });
  });

  it("extracts publicationId from nested event if present", () => {
    const scope = assertJobScope({
      scope: "publication",
      event: { publicationId: "pub_gamma", eventName: "post.view" },
    });
    expect(scope).toEqual({ scope: "publication", publicationId: "pub_gamma" });
  });

  it("infers publication scope when publicationId is explicitly provided", () => {
    const scope = assertJobScope({
      publicationId: "pub_delta",
      runId: "run-1",
    });
    expect(scope).toEqual({ scope: "publication", publicationId: "pub_delta" });
  });

  it("rejects jobs without explicit scope or publicationId", () => {
    expect(() =>
      assertJobScope({
        runId: "run-1",
        op: "upsert",
      }),
    ).toThrow(/must specify scope/i);
  });

  it("rejects publication-scoped jobs with empty publicationId", () => {
    expect(() =>
      assertJobScope({
        scope: "publication",
        publicationId: "   ",
      }),
    ).toThrow(/must include a non-empty publicationId/i);
  });
});
