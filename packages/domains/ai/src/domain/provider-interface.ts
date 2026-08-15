import {
  AiCompletionOptions,
  AiCompletionResult,
  AiMessage,
  AiProviderType,
  AiStreamChunk,
} from "./types";

export interface AiProvider {
  readonly providerType: AiProviderType;

  /**
   * Generates a complete text response from the model.
   */
  generateCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions,
  ): Promise<AiCompletionResult>;

  /**
   * Streams completion tokens asynchronously.
   */
  streamCompletion(
    messages: AiMessage[],
    options?: AiCompletionOptions,
  ): AsyncIterable<AiStreamChunk>;

  /**
   * Lists available models for this provider.
   */
  listModels(): Promise<string[]>;
}
