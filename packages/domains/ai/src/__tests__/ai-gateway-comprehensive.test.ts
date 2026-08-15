import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AiGatewayService,
  DeterministicTestProvider,
  AiProviderType,
  AiBudgetExceededError,
} from "../index";

vi.mock("@vibress/database", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => Promise.resolve(),
    }),
    select: () => ({
      from: () => Promise.resolve([{ total: 42 }]),
    }),
  }),
  aiAuditLogs: {},
}));

describe("AiGatewayService — Comprehensive Capability Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes deterministic completions with token usage and model metadata", async () => {
    const testProvider = new DeterministicTestProvider({
      customResponse: "Polished editorial text.",
    });
    const gateway = new AiGatewayService(
      {
        enabled: true,
        primaryProvider: "openai",
        providers: {},
        rateLimitPerMinute: 60,
        monthlyTokenBudget: 1000000,
      },
      new Map([["openai", testProvider]]),
    );

    const result = await gateway.generate({
      task: "continue",
      prompt: "The beginning of the story",
      context: "Draft chapter 1",
    });

    expect(result.text).toBe("Polished editorial text.");
    expect(result.provider).toBe("openai");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("streams tokens via async iterable from DeterministicTestProvider", async () => {
    const testProvider = new DeterministicTestProvider({
      customResponse: "Hello streamed world",
    });
    const gateway = new AiGatewayService(
      {
        enabled: true,
        primaryProvider: "openai",
        providers: {},
        rateLimitPerMinute: 60,
        monthlyTokenBudget: 1000000,
      },
      new Map([["openai", testProvider]]),
    );

    const chunks: string[] = [];
    for await (const chunk of gateway.stream({
      task: "inline",
      prompt: "Continue",
    })) {
      chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("Hello streamed world");
  });

  it("builds specialized system prompts across all editorial operations", () => {
    const gateway = new AiGatewayService({
      enabled: true,
      primaryProvider: "openai",
      providers: {},
      rateLimitPerMinute: 60,
      monthlyTokenBudget: 1000000,
    });

    const tasks: Array<
      | "continue"
      | "rewrite"
      | "shorten"
      | "expand"
      | "tone"
      | "translate"
      | "summarize"
      | "outline"
      | "excerpt"
      | "headline"
      | "seo"
      | "altText"
      | "internalLinks"
    > = [
      "continue",
      "rewrite",
      "shorten",
      "expand",
      "tone",
      "translate",
      "summarize",
      "outline",
      "excerpt",
      "headline",
      "seo",
      "altText",
      "internalLinks",
    ];

    for (const task of tasks) {
      const messages = gateway.buildMessagesForTask({
        task,
        prompt: "Sample text prompt",
        context: "Sample context draft",
        targetLanguage: "Arabic",
        targetTone: "Persuasive",
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0]?.role).toBe("system");
      expect(messages[messages.length - 1]?.role).toBe("user");
    }
  });

  it("trips circuit breaker when provider fails repeatedly", async () => {
    const failingProvider = {
      providerType: "openai" as AiProviderType,
      generateCompletion: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
      streamCompletion: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
    };

    const gateway = new AiGatewayService(
      {
        enabled: true,
        primaryProvider: "openai",
        providers: {},
        rateLimitPerMinute: 60,
        monthlyTokenBudget: 1000000,
      },
      new Map([["openai", failingProvider]]),
    );

    // Trip circuit breaker with 5 failures
    for (let i = 0; i < 5; i++) {
      await expect(gateway.generate({ prompt: "test" })).rejects.toThrow();
    }

    // 6th attempt should be blocked by circuit breaker
    await expect(gateway.generate({ prompt: "test" })).rejects.toThrow(
      "All AI providers are currently unavailable or circuit broken",
    );
  });

  it("enforces rate limit per minute per user", async () => {
    const testProvider = new DeterministicTestProvider();
    const gateway = new AiGatewayService(
      {
        enabled: true,
        primaryProvider: "openai",
        providers: {},
        rateLimitPerMinute: 2, // low rate limit for testing
        monthlyTokenBudget: 1000000,
      },
      new Map([["openai", testProvider]]),
    );

    // 1st request ok
    await gateway.generate({ prompt: "1", userId: "user_a" });
    // 2nd request ok
    await gateway.generate({ prompt: "2", userId: "user_a" });
    // 3rd request should exceed rate limit
    await expect(
      gateway.generate({ prompt: "3", userId: "user_a" }),
    ).rejects.toThrow(/rate limit.*exceeded/i);
  });

  it("enforces token budget limits", async () => {
    const testProvider = new DeterministicTestProvider();
    const gateway = new AiGatewayService(
      {
        enabled: true,
        primaryProvider: "openai",
        providers: {},
        rateLimitPerMinute: 60,
        monthlyTokenBudget: 50, // very small budget for testing
      },
      new Map([["openai", testProvider]]),
    );

    // Initial check should reject if estimated tokens exceed monthly budget
    await expect(
      gateway.generate({ prompt: "long text", maxTokens: 100 }),
    ).rejects.toThrow(AiBudgetExceededError);
  });
});

