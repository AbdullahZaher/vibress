export const API_BASE = '/api/admin/v1';

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
    public path?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const hasBody = options.body != null;
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorDetail = data.errors?.[0] || {};
    const err = new ApiError(
      errorDetail.code || 'UNKNOWN_ERROR',
      errorDetail.message || 'An unexpected error occurred',
      response.status,
      errorDetail.path
    );
    (err as unknown as Record<string, unknown>).referenceCount = errorDetail.referenceCount;
    throw err;
  }

  return data as T;
}