import { AiProvider } from "../../domain/provider-interface";
import {
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
  AiProviderType,
  AiStreamChunk,
} from "../../domain/types";

export class GeminiProvider implements AiProvider {
  readonly providerType: AiProviderType = "gemini";
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string | undefined }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (
      config.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
  }

  async generateCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();
    const model = options?.model || "gemini-1.5-pro";

    const systemInstruction = messages.find((m) => m.role === "system");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction.content }],
      };
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Gemini API error (${response.status}): ${errText || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

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
    const model = options?.model || "gemini-1.5-pro";

    const systemInstruction = messages.find((m) => m.role === "system");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction.content }],
      };
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok || !response.body) {
      const errText = await response.text();
      throw new Error(
        `Gemini Streaming error (${response.status}): ${errText || response.statusText}`,
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
            const chunkText =
              parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (chunkText) {
              yield {
                text: chunkText,
                done: false,
                model,
                provider: this.providerType,
              };
            }
          } catch {
            // Ignore partial SSE lines
          }
        }
      }
      yield { text: "", done: true, model, provider: this.providerType };
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    return ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"];
  }
}
