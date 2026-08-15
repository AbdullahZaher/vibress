import { AiProvider } from "../../domain/provider-interface";
import {
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
  AiProviderType,
  AiStreamChunk,
} from "../../domain/types";

export class DeterministicTestProvider implements AiProvider {
  readonly providerType: AiProviderType = "openai";
  private customResponse?: string | undefined;

  constructor(options?: { customResponse?: string | undefined }) {
    this.customResponse = options?.customResponse;
  }

  setResponse(response: string): void {
    this.customResponse = response;
  }

  async listModels(): Promise<string[]> {
    return ["deterministic-mock", "deterministic-v1"];
  }

  async generateCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions | undefined,
  ): Promise<AiCompletionResult> {
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const responseText =
      this.customResponse || `Deterministic AI response for: ${lastUserMessage}`;

    return {
      text: responseText,
      model: options?.model || "deterministic-mock",
      provider: this.providerType,
      usage: {
        promptTokens: Math.ceil(lastUserMessage.length / 4),
        completionTokens: Math.ceil(responseText.length / 4),
        totalTokens:
          Math.ceil(lastUserMessage.length / 4) +
          Math.ceil(responseText.length / 4),
      },
      latencyMs: 15,
    };
  }

  async *streamCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions | undefined,
  ): AsyncIterable<AiStreamChunk> {
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const responseText =
      this.customResponse || `Deterministic AI stream: ${lastUserMessage}`;
    const words = responseText.split(" ");

    for (let i = 0; i < words.length; i++) {
      const isLast = i === words.length - 1;
      yield {
        text: words[i] + (isLast ? "" : " "),
        done: isLast,
        model: options?.model || "deterministic-mock",
        provider: this.providerType,
      };
    }
  }
}
