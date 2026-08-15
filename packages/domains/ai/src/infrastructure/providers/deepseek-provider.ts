import { OpenAiProvider } from "./openai-provider";
import { AiProviderType } from "../../domain/types";

export class DeepSeekProvider extends OpenAiProvider {
  override readonly providerType: AiProviderType = "deepseek";

  constructor(config: { apiKey: string; baseUrl?: string | undefined }) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://api.deepseek.com/v1",
    });
  }

  override async listModels(): Promise<string[]> {
    return ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"];
  }
}
