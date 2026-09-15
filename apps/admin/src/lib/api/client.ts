export const API_BASE = "/api/admin/v1";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  status?: string;
  roles: string[];
  permissions: string[];
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
    public path?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let inMemoryPublicationId: string | null = null;

export function setActivePublicationId(id: string | null): void {
  inMemoryPublicationId = id;
  if (typeof window !== "undefined") {
    if (id) {
      localStorage.setItem("vibress_active_publication_id", id);
    } else {
      localStorage.removeItem("vibress_active_publication_id");
    }
  }
}

export function getActivePublicationId(): string | null {
  if (inMemoryPublicationId) return inMemoryPublicationId;
  if (typeof window !== "undefined") {
    return localStorage.getItem("vibress_active_publication_id");
  }
  return null;
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const cleanEndpoint = endpoint.startsWith(API_BASE)
    ? endpoint.slice(API_BASE.length)
    : endpoint;
  const url = `${API_BASE}${cleanEndpoint.startsWith("/") ? cleanEndpoint : `/${cleanEndpoint}`}`;
  const hasBody = options.body != null;
  const pubId = getActivePublicationId();
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(pubId ? { "X-Publication-Id": pubId } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorDetail = data.errors?.[0] || {};
    const err = new ApiError(
      errorDetail.code || "UNKNOWN_ERROR",
      errorDetail.message || "An unexpected error occurred",
      response.status,
      errorDetail.path,
    );
    (err as unknown as Record<string, unknown>).referenceCount =
      errorDetail.referenceCount;
    throw err;
  }

  return data as T;
}
