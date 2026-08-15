export type AiProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "ollama";

export type AiTaskType =
  | "completion"
  | "inline"
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
  | "internalLinks";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionOptions {
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  stop?: string[] | undefined;
  stream?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiCompletionResult {
  text: string;
  model: string;
  provider: AiProviderType;
  usage: AiTokenUsage;
  latencyMs: number;
}

export interface AiStreamChunk {
  text: string;
  done: boolean;
  model?: string | undefined;
  provider?: AiProviderType | undefined;
}

export interface AiProviderConfig {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  defaultModel?: string | undefined;
}

export interface AiGatewayConfig {
  enabled: boolean;
  primaryProvider: AiProviderType;
  fallbackProvider?: AiProviderType | undefined;
  defaultModel?: string | undefined;
  providers: Partial<Record<AiProviderType, AiProviderConfig>>;
  rateLimitPerMinute: number;
  monthlyTokenBudget: number;
}

export interface AiAuditLogRecord {
  id: string;
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
  createdAt: Date;
}
