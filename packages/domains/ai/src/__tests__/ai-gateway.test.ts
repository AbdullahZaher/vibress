import { describe, it, expect } from "vitest";
import { AiGatewayService } from "../application/ai-gateway-service";
import { AiMessage } from "../domain/types";

describe("AI Gateway Service", () => {
  it("initializes enabled state based on configuration and available providers", () => {
    const aiService = new AiGatewayService({
      enabled: true,
      primaryProvider: "openai",
      rateLimitPerMinute: 60,
      monthlyTokenBudget: 100000,
      providers: {
        openai: { apiKey: "test-openai-key" },
      },
    });

    expect(aiService.isEnabled()).toBe(true);
    expect(aiService.getAvailableProviders()).toContain("openai");
  });

  it("handles disabled state gracefully", async () => {
    const aiService = new AiGatewayService({
      enabled: false,
      primaryProvider: "openai",
      rateLimitPerMinute: 60,
      monthlyTokenBudget: 100000,
      providers: {
        openai: { apiKey: "test-openai-key" },
      },
    });

    expect(aiService.isEnabled()).toBe(false);
    await expect(
      aiService.generate({ prompt: "Hello" }),
    ).rejects.toThrow(/disabled/i);
  });

  it("constructs specialized editorial prompts for tasks (inline, tone, summarize, translate, seo)", () => {
    const aiService = new AiGatewayService({
      enabled: true,
      primaryProvider: "openai",
      rateLimitPerMinute: 60,
      monthlyTokenBudget: 100000,
      providers: {
        openai: { apiKey: "test-key" },
      },
    });

    const buildMessages = (aiService as unknown as {
      buildMessagesForTask: (opt: Record<string, unknown>) => AiMessage[];
    }).buildMessagesForTask.bind(aiService);

    // 1. Inline completion
    const inlineMsgs = buildMessages({
      task: "inline",
      prompt: "Next paragraph",
      context: "Previous paragraph",
    });
    expect(inlineMsgs[0]?.content).toContain("editorial writing assistant");
    expect(inlineMsgs[1]?.content).toContain("Previous paragraph");

    // 2. Tone adjustment
    const toneMsgs = buildMessages({
      task: "tone",
      prompt: "Draft text",
      targetTone: "professional",
    });
    expect(toneMsgs[0]?.content).toContain("professional");

    // 3. Summarize
    const sumMsgs = buildMessages({
      task: "summarize",
      prompt: "Long article text",
    });
    expect(sumMsgs[0]?.content).toContain("executive editor");

    // 4. Translate
    const transMsgs = buildMessages({
      task: "translate",
      prompt: "Hello",
      targetLanguage: "Spanish",
    });
    expect(transMsgs[0]?.content).toContain("Spanish");

    // 5. SEO metadata
    const seoMsgs = buildMessages({
      task: "seo",
      prompt: "Post Title",
      context: "Post Markdown Content",
    });
    expect(seoMsgs[0]?.content).toContain("meta title");
    expect(seoMsgs[0]?.content).toContain("metaDescription");
  });
});
