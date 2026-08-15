import { apiRequest } from "./client";

export interface AiStatusResponse {
  enabled: boolean;
  providers: string[];
}

export interface AiGenerateResponse {
  text: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export async function fetchAiStatus(): Promise<AiStatusResponse> {
  const res = await apiRequest<{ data: AiStatusResponse }>("/ai/status");
  return res.data;
}

export async function generateAiCompletion(params: {
  prompt?: string | undefined;
  context?: string | undefined;
  task?:
    | "completion"
    | "inline"
    | "tone"
    | "summarize"
    | "translate"
    | "seo"
    | undefined;
  targetLanguage?: string | undefined;
  targetTone?: string | undefined;
  model?: string | undefined;
}): Promise<string> {
  const res = await apiRequest<{ data: AiGenerateResponse }>("/ai/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return res.data.text;
}
