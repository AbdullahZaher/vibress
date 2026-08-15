import { describe, it, expect, vi } from "vitest";
import {
  evaluateConditions,
  AutomationsService,
  AutomationCondition,
} from "../index";

describe("Visual Automations Engine", () => {
  describe("Condition Evaluation", () => {
    it("evaluates equals condition successfully on dotted path", () => {
      const conditions: AutomationCondition[] = [
        { field: "member.plan", op: "equals", value: "pro" },
        { field: "status", op: "equals", value: "active" },
      ];

      expect(
        evaluateConditions(conditions, {
          member: { plan: "pro" },
          status: "active",
        }),
      ).toBe(true);

      expect(
        evaluateConditions(conditions, {
          member: { plan: "free" },
          status: "active",
        }),
      ).toBe(false);
    });

    it("evaluates exists condition", () => {
      const conditions: AutomationCondition[] = [
        { field: "post.featuredImage", op: "exists" },
      ];

      expect(
        evaluateConditions(conditions, {
          post: { featuredImage: "https://cdn.example.com/cover.jpg" },
        }),
      ).toBe(true);

      expect(
        evaluateConditions(conditions, {
          post: {},
        }),
      ).toBe(false);
    });
  });

  describe("Event Matching & Idempotency", () => {
    it("dispatches active automation when trigger matches", async () => {
      const mockRepo = {
        listActiveByTrigger: vi.fn().mockResolvedValue([
          {
            id: "auto-1",
            version: 1,
            conditions: [],
            actions: [{ type: "webhook", config: { url: "https://hook.site" } }],
          },
        ]),
        findRun: vi.fn().mockResolvedValue(null),
        createRun: vi.fn().mockResolvedValue({ id: "run-101" }),
      };
      const mockDispatcher = {
        enqueueRun: vi.fn().mockResolvedValue(undefined),
        enqueueDelayedStep: vi.fn().mockResolvedValue(undefined),
      };
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({ result: { success: true } }),
      };

      const service = new AutomationsService(
        mockRepo as any,
        mockDispatcher as any,
        mockExecutor as any,
      );

      const created = await service.handleEvent("post.published", {
        postId: "p-123",
      });

      expect(created).toBe(1);
      expect(mockRepo.createRun).toHaveBeenCalled();
      expect(mockDispatcher.enqueueRun).toHaveBeenCalledWith("run-101");
    });
  });
});
