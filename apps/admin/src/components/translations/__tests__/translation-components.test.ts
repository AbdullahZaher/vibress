import { describe, it, expect } from "vitest";
import { TranslationStatusType } from "../TranslationBadge";

export const ALLOWED_STATUS_TRANSITIONS: Record<TranslationStatusType, TranslationStatusType[]> = {
  untranslated: ["draft", "in_progress", "needs_review"],
  draft: ["in_progress", "needs_review", "stale"],
  in_progress: ["draft", "needs_review", "stale"],
  needs_review: ["approved", "in_progress", "draft", "stale"],
  approved: ["published", "needs_review", "draft", "stale"],
  published: ["stale", "needs_review", "draft", "approved"],
  stale: ["in_progress", "needs_review", "approved", "published", "draft"],
};

export function validateStatusTransition(
  current: TranslationStatusType,
  target: TranslationStatusType,
): boolean {
  if (current === target) return true;
  const allowed = ALLOWED_STATUS_TRANSITIONS[current] || [];
  return allowed.includes(target);
}

describe("Translation UI and Workflow Unit Tests", () => {
  describe("Translation Status Transition Validations", () => {
    it("allows valid forward transitions in editorial pipeline", () => {
      expect(validateStatusTransition("untranslated", "draft")).toBe(true);
      expect(validateStatusTransition("draft", "needs_review")).toBe(true);
      expect(validateStatusTransition("needs_review", "approved")).toBe(true);
      expect(validateStatusTransition("approved", "published")).toBe(true);
      expect(validateStatusTransition("published", "stale")).toBe(true);
      expect(validateStatusTransition("stale", "in_progress")).toBe(true);
    });

    it("rejects unauthorized status jumps (e.g. untranslated direct to published)", () => {
      expect(validateStatusTransition("untranslated", "published")).toBe(false);
    });

    it("allows same-status transitions as no-ops", () => {
      expect(validateStatusTransition("draft", "draft")).toBe(true);
      expect(validateStatusTransition("published", "published")).toBe(true);
    });
  });

  describe("Status Transitions Mapping", () => {
    it("defines exhaustive transitions for all canonical statuses", () => {
      const keys = Object.keys(ALLOWED_STATUS_TRANSITIONS);
      expect(keys).toContain("untranslated");
      expect(keys).toContain("draft");
      expect(keys).toContain("in_progress");
      expect(keys).toContain("needs_review");
      expect(keys).toContain("approved");
      expect(keys).toContain("published");
      expect(keys).toContain("stale");
    });
  });
});
