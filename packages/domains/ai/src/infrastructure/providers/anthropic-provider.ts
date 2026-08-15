import { AiProvider } from "../../domain/provider-interface";
import {
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
  AiProviderType,
  AiStreamChunk,
} from "../../domain/types";

export class AnthropicProvider implements AiProvider {
  readonly providerType: AiProviderType = "anthropic";
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string | undefined }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (
      config.baseUrl || "https://api.anthropic.com/v1"
    ).replace(/\/+$/, "");
  }

  async generateCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();
    const model = options?.model || "claude-3-5-sonnet-20241022";

    // Extract system prompt if present
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        messages: nonSystemMessages,
        system: systemMessage?.content,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Anthropic API error (${response.status}): ${errText || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const text =
      data.content?.find((c) => c.type === "text")?.text ?? "";
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    return {
      text,
      model,
      provider: this.providerType,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  async *streamCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions,
  ): AsyncIterable<AiStreamChunk> {
    const model = options?.model || "claude-3-5-sonnet-20241022";

    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        messages: nonSystemMessages,
        system: systemMessage?.content,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text();
      throw new Error(
        `Anthropic Streaming error (${response.status}): ${errText || response.statusText}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta"
            ) {
              yield {
                text: parsed.delta.text,
                done: false,
                model,
                provider: this.providerType,
              };
            } else if (parsed.type === "message_stop") {
              yield {
                text: "",
                done: true,
                model,
                provider: this.providerType,
              };
              return;
            }
          } catch {
            // Ignore partial SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    return [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ];
  }
}
