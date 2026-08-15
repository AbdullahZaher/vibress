import { AiProvider } from "../domain/provider-interface";
import {
  AiCompletionOptions,
  AiCompletionResult,
  AiGatewayConfig,
  AiMessage,
  AiProviderType,
  AiStreamChunk,
  AiTaskType,
} from "../domain/types";
import { OpenAiProvider } from "../infrastructure/providers/openai-provider";
import { AnthropicProvider } from "../infrastructure/providers/anthropic-provider";
import { GeminiProvider } from "../infrastructure/providers/gemini-provider";
import { DeepSeekProvider } from "../infrastructure/providers/deepseek-provider";
import { OllamaProvider } from "../infrastructure/providers/ollama-provider";
import { DeterministicTestProvider } from "../infrastructure/providers/deterministic-test-provider";
import { getDb, aiAuditLogs } from "@vibress/database";
import { count } from "drizzle-orm";
import { randomUUID } from "crypto";

export class AiRateLimitExceededError extends Error {
  constructor(message = "AI request rate limit exceeded. Please try again later.") {
    super(message);
    this.name = "AiRateLimitExceededError";
  }
}

export class AiBudgetExceededError extends Error {
  constructor(message = "Monthly AI token budget limit exceeded.") {
    super(message);
    this.name = "AiBudgetExceededError";
  }
}

export interface GenerateTaskOptions extends AiCompletionOptions {
  task?: AiTaskType | undefined;
  prompt?: string | undefined;
  context?: string | undefined;
  targetLanguage?: string | undefined;
  targetTone?: string | undefined;
  userId?: string | undefined;
}

export class AiGatewayService {
  private config: AiGatewayConfig;
  private providers: Map<AiProviderType, AiProvider> = new Map();
  private failureCounts: Map<AiProviderType, number> = new Map();
  private lastFailureTime: Map<AiProviderType, number> = new Map();
  private userRequestTimestamps: Map<string, number[]> = new Map();
  private totalUsedTokens = 0;
  private readonly circuitBreakerThreshold = 5;
  private readonly circuitBreakerResetMs = 60000; // 1 minute

  constructor(config: AiGatewayConfig, customProviders?: Map<AiProviderType, AiProvider>) {
    this.config = config;
    if (customProviders) {
      this.providers = customProviders;
    } else {
      this.initProviders();
    }
  }

  private initProviders(): void {
    const p = this.config.providers;

    if (p.openai?.apiKey) {
      this.providers.set(
        "openai",
        new OpenAiProvider({
          apiKey: p.openai.apiKey,
          baseUrl: p.openai.baseUrl,
        }),
      );
    }

    if (p.anthropic?.apiKey) {
      this.providers.set(
        "anthropic",
        new AnthropicProvider({
          apiKey: p.anthropic.apiKey,
          baseUrl: p.anthropic.baseUrl,
        }),
      );
    }

    if (p.gemini?.apiKey) {
      this.providers.set(
        "gemini",
        new GeminiProvider({
          apiKey: p.gemini.apiKey,
          baseUrl: p.gemini.baseUrl,
        }),
      );
    }

    if (p.deepseek?.apiKey) {
      this.providers.set(
        "deepseek",
        new DeepSeekProvider({
          apiKey: p.deepseek.apiKey,
          baseUrl: p.deepseek.baseUrl,
        }),
      );
    }

    if (p.ollama?.baseUrl) {
      this.providers.set(
        "ollama",
        new OllamaProvider({ baseUrl: p.ollama.baseUrl }),
      );
    }
  }

  public registerTestProvider(provider: DeterministicTestProvider): void {
    this.providers.set("openai", provider);
  }

  public isEnabled(): boolean {
    return this.config.enabled && this.providers.size > 0;
  }

  public getAvailableProviders(): AiProviderType[] {
    return Array.from(this.providers.keys());
  }

  private isCircuitOpen(providerType: AiProviderType): boolean {
    const failures = this.failureCounts.get(providerType) || 0;
    const lastFailure = this.lastFailureTime.get(providerType) || 0;
    if (failures >= this.circuitBreakerThreshold) {
      if (Date.now() - lastFailure > this.circuitBreakerResetMs) {
        // Half-open: allow retry
        this.failureCounts.set(providerType, 0);
        return false;
      }
      return true;
    }
    return false;
  }

  private recordSuccess(providerType: AiProviderType): void {
    this.failureCounts.set(providerType, 0);
  }

  private recordFailure(providerType: AiProviderType): void {
    const count = (this.failureCounts.get(providerType) || 0) + 1;
    this.failureCounts.set(providerType, count);
    this.lastFailureTime.set(providerType, Date.now());
  }

  private getProvider(requestedProvider?: AiProviderType): {
    primary: AiProvider;
    fallback?: AiProvider | undefined;
  } {
    const primaryType = requestedProvider || this.config.primaryProvider;
    let primary = this.providers.get(primaryType);

    // If primary circuit is open, attempt to fallback
    if (this.isCircuitOpen(primaryType)) {
      console.warn(`[AiGateway] Circuit breaker open for ${primaryType}`);
      primary = undefined;
    }

    if (!primary) {
      const fallbackType = this.config.fallbackProvider;
      if (fallbackType && !this.isCircuitOpen(fallbackType)) {
        primary = this.providers.get(fallbackType);
      }
      if (!primary) {
        for (const [type, prov] of this.providers.entries()) {
          if (!this.isCircuitOpen(type)) {
            primary = prov;
            break;
          }
        }
      }
      if (!primary) {
        throw new Error(
          `All AI providers are currently unavailable or circuit broken.`,
        );
      }
      return { primary };
    }

    const fallbackType = this.config.fallbackProvider;
    const fallback =
      fallbackType &&
      fallbackType !== primaryType &&
      !this.isCircuitOpen(fallbackType)
        ? this.providers.get(fallbackType)
        : undefined;

    return { primary, fallback };
  }

  /**
   * Constructs prompt messages for specific editorial tasks
   */
  public buildMessagesForTask(options: GenerateTaskOptions): AiMessage[] {
    const task = options.task || "completion";
    const prompt = options.prompt || "";
    const context = options.context || "";

    switch (task) {
      case "inline":
      case "continue":
        return [
          {
            role: "system",
            content:
              "You are an expert editorial writing assistant inside the Vibress Studio editor. " +
              "Continue the text seamlessly from the user's cursor position. " +
              "Match the writing style, tone, and vocabulary of the context. " +
              "Output ONLY the continuation text with NO markdown headers or conversational commentary.",
          },
          ...(context
            ? ([{ role: "user", content: `Context:\n${context}` }] as AiMessage[])
            : []),
          { role: "user", content: `Continue writing: ${prompt}` },
        ];

      case "rewrite":
        return [
          {
            role: "system",
            content:
              "You are a master editor. Rewrite the selected text to maximize clarity, conciseness, and flow. " +
              "Preserve original meaning. Output ONLY the rewritten text.",
          },
          { role: "user", content: prompt },
        ];

      case "shorten":
        return [
          {
            role: "system",
            content:
              "You are an editor specializing in brevity. Shorten the text to be punchy while preserving essential details. " +
              "Output ONLY the shortened text.",
          },
          { role: "user", content: prompt },
        ];

      case "expand":
        return [
          {
            role: "system",
            content:
              "You are an expert editorial collaborator. Elaborate and expand upon the ideas in the text with vivid detail, depth, and structured supporting explanations. " +
              "Output ONLY the expanded text.",
          },
          { role: "user", content: prompt },
        ];

      case "tone":
        return [
          {
            role: "system",
            content:
              `You are an expert copy editor. Rewrite the text to have a ${options.targetTone || "engaging"} tone. ` +
              "Preserve key facts and structure. Output ONLY the rewritten text.",
          },
          { role: "user", content: prompt },
        ];

      case "summarize":
        return [
          {
            role: "system",
            content:
              "You are an executive editor. Provide a concise, clear summary of the text with key takeaways. " +
              "Use clean bullet points.",
          },
          { role: "user", content: prompt },
        ];

      case "translate":
        return [
          {
            role: "system",
            content:
              `You are a professional literary translator. Translate the text into ${options.targetLanguage || "English"}. ` +
              "Preserve formatting and nuances accurately. Output ONLY the translation.",
          },
          { role: "user", content: prompt },
        ];

      case "outline":
        return [
          {
            role: "system",
            content:
              "You are a publication strategist. Generate a structured article outline with clear headings and bulleted subtopics.",
          },
          { role: "user", content: `Topic / Draft:\n${prompt}\n\nContext:\n${context}` },
        ];

      case "excerpt":
        return [
          {
            role: "system",
            content:
              "Generate a compelling 1-2 sentence article excerpt/teaser (under 160 characters) that hooks readers without sensationalism. Output ONLY the excerpt.",
          },
          { role: "user", content: `Title: ${prompt}\n\nContent:\n${context}` },
        ];

      case "headline":
        return [
          {
            role: "system",
            content:
              "You are an editorial headline expert. Generate 5 diverse headline alternatives (curiosity, direct, question, benefit, listicle). Respond with clean numbered items.",
          },
          { role: "user", content: `Current headline / Draft: ${prompt}` },
        ];

      case "seo":
        return [
          {
            role: "system",
            content:
              "You are a search engine optimization specialist. " +
              "Generate a compelling meta title (under 60 characters) and meta description (under 160 characters). " +
              "Respond ONLY in valid JSON format: { \"metaTitle\": \"...\", \"metaDescription\": \"...\" }",
          },
          { role: "user", content: `Title: ${prompt}\n\nContent:\n${context}` },
        ];

      case "altText":
        return [
          {
            role: "system",
            content:
              "You are an accessibility and SEO specialist. Generate concise, descriptive alt text for an image based on its context. Output ONLY the alt text string.",
          },
          { role: "user", content: `Image description / context: ${prompt}` },
        ];

      case "internalLinks":
        return [
          {
            role: "system",
            content:
              "You are a content linking assistant. Suggest relevant internal link anchor opportunities for the text. Output ONLY formatted bullet points of suggested anchor phrases and linking topics.",
          },
          { role: "user", content: `Content:\n${context || prompt}` },
        ];

      case "completion":
      default:
        return [
          {
            role: "system",
            content:
              "You are an intelligent AI assistant integrated into the Vibress publishing platform.",
          },
          ...(context
            ? ([{ role: "user", content: `Context:\n${context}` }] as AiMessage[])
            : []),
          { role: "user", content: prompt },
        ];
    }
  }

  private checkRateLimit(key = "anonymous"): void {
    const now = Date.now();
    const windowMs = 60000;
    const timestamps = this.userRequestTimestamps.get(key) || [];
    const recent = timestamps.filter((t) => now - t < windowMs);

    if (this.config.rateLimitPerMinute > 0 && recent.length >= this.config.rateLimitPerMinute) {
      throw new AiRateLimitExceededError(
        `AI rate limit of ${this.config.rateLimitPerMinute} requests/minute exceeded for ${key}.`,
      );
    }

    recent.push(now);
    this.userRequestTimestamps.set(key, recent);
  }

  private checkBudget(estimatedTokens = 100): void {
    if (
      this.config.monthlyTokenBudget > 0 &&
      this.totalUsedTokens + estimatedTokens > this.config.monthlyTokenBudget
    ) {
      throw new AiBudgetExceededError(
        `AI monthly token budget of ${this.config.monthlyTokenBudget} tokens exceeded.`,
      );
    }
  }

  /**
   * Generates AI completion with automatic fallback, circuit breaker, rate limit, and budget control.
   */
  async generate(options: GenerateTaskOptions): Promise<AiCompletionResult> {
    if (!this.config.enabled) {
      throw new Error("AI features are currently disabled on this instance.");
    }

    this.checkRateLimit(options.userId || "anonymous");
    this.checkBudget(options.maxTokens || 200);

    const { primary, fallback } = this.getProvider();
    const messages = this.buildMessagesForTask(options);
    const startTime = Date.now();

    try {
      const result = await primary.generateCompletion(messages, options);
      this.recordSuccess(primary.providerType);
      this.totalUsedTokens += result.usage.totalTokens;
      await this.logAudit({
        userId: options.userId ?? null,
        provider: result.provider,
        model: result.model,
        task: options.task || "completion",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        latencyMs: result.latencyMs,
        status: "success",
      });
      return result;
    } catch (primaryErr) {
      this.recordFailure(primary.providerType);
      console.warn(
        `[AiGateway] Primary provider (${primary.providerType}) failed:`,
        primaryErr,
      );

      if (fallback) {
        console.info(
          `[AiGateway] Attempting fallback to ${fallback.providerType}...`,
        );
        try {
          const result = await fallback.generateCompletion(messages, options);
          this.recordSuccess(fallback.providerType);
          this.totalUsedTokens += result.usage.totalTokens;
          await this.logAudit({
            userId: options.userId ?? null,
            provider: result.provider,
            model: result.model,
            task: options.task || "completion",
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            latencyMs: result.latencyMs,
            status: "success",
          });
          return result;
        } catch (fallbackErr) {
          this.recordFailure(fallback.providerType);
          const errorMsg = `Primary (${primary.providerType}): ${String(primaryErr)}; Fallback (${fallback.providerType}): ${String(fallbackErr)}`;
          await this.logAudit({
            userId: options.userId ?? null,
            provider: primary.providerType,
            model: options.model || "default",
            task: options.task || "completion",
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            latencyMs: Date.now() - startTime,
            status: "error",
            errorMessage: errorMsg,
          });
          throw new Error(`AI generation failed on all providers: ${errorMsg}`, {
            cause: fallbackErr,
          });
        }
      }

      await this.logAudit({
        userId: options.userId ?? null,
        provider: primary.providerType,
        model: options.model || "default",
        task: options.task || "completion",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
        status: "error",
        errorMessage: String(primaryErr),
      });

      throw primaryErr;
    }
  }

  /**
   * Streams AI completion tokens asynchronously with cancellation support.
   */
  async *stream(
    options: GenerateTaskOptions,
  ): AsyncIterable<AiStreamChunk> {
    if (!this.config.enabled) {
      throw new Error("AI features are currently disabled on this instance.");
    }

    this.checkRateLimit(options.userId || "anonymous");
    this.checkBudget(options.maxTokens || 200);

    const { primary } = this.getProvider();
    const messages = this.buildMessagesForTask(options);

    yield* primary.streamCompletion(messages, options);
  }

  /**
   * Records execution audit record into database.
   */
  private async logAudit(record: {
    userId: string | null;
    provider: string;
    model: string;
    task: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: "success" | "error";
    errorMessage?: string | null | undefined;
  }): Promise<void> {
    try {
      const db = getDb();
      await db.insert(aiAuditLogs).values({
        id: randomUUID(),
        userId: record.userId,
        provider: record.provider,
        model: record.model,
        task: record.task,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        latencyMs: record.latencyMs,
        status: record.status,
        errorMessage: record.errorMessage ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("[AiGateway] Failed to insert AI audit log:", err);
    }
  }

  /**
   * Gets aggregated AI metrics for Admin analytics.
   */
  async getMetrics(): Promise<{
    totalRequests: number;
  }> {
    try {
      const db = getDb();
      const rows = await db.select({ total: count() }).from(aiAuditLogs);
      return { totalRequests: Number(rows[0]?.total ?? 0) };
    } catch {
      return { totalRequests: 0 };
    }
  }
}
