import { AiProvider } from "../../domain/provider-interface";
import {
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
  AiProviderType,
  AiStreamChunk,
} from "../../domain/types";

export class OllamaProvider implements AiProvider {
  readonly providerType: AiProviderType = "ollama";
  private baseUrl: string;

  constructor(config: { baseUrl?: string | undefined }) {
    this.baseUrl = (config.baseUrl || "http://localhost:11434").replace(
      /\/+$/,
      "",
    );
  }

  async generateCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();
    const model = options?.model || "llama3.2";

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${errText || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const text = data.message?.content ?? "";
    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;

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
    const model = options?.model || "llama3.2";

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text();
      throw new Error(
        `Ollama Streaming error (${response.status}): ${errText || response.statusText}`,
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
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.message?.content) {
              yield {
                text: parsed.message.content,
                done: false,
                model,
                provider: this.providerType,
              };
            }
            if (parsed.done) {
              yield { text: "", done: true, model, provider: this.providerType };
              return;
            }
          } catch {
            // Ignore incomplete JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return ["llama3.2", "mistral", "qwen2.5"];
      const data = (await response.json()) as {
        models?: Array<{ name: string }>;
      };
      return data.models?.map((m) => m.name) || ["llama3.2", "mistral"];
    } catch {
      return ["llama3.2", "mistral", "qwen2.5"];
    }
  }
}
