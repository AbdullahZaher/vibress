import { apiRequest } from "./client";

export interface WhatsNewItem {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  icon?: string | undefined;
  url?: string | undefined;
  minVersion?: string | undefined;
  maxVersion?: string | undefined;
}

export interface WhatsNewResponse {
  item: WhatsNewItem | null;
  items: WhatsNewItem[];
  dismissedIds: string[];
  version: string;
}

export interface DismissWhatsNewResponse {
  success: boolean;
  dismissedIds: string[];
}

export function isSafeWhatsNewUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") {
    return true;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("ftp:")
  ) {
    return false;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function getWhatsNewApi(): Promise<WhatsNewResponse> {
  return apiRequest<WhatsNewResponse>("/whats-new");
}

export async function dismissWhatsNewApi(
  notificationId: string,
): Promise<DismissWhatsNewResponse> {
  return apiRequest<DismissWhatsNewResponse>(
    `/whats-new/${encodeURIComponent(notificationId)}/dismiss`,
    {
      method: "POST",
    },
  );
}
