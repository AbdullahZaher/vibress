/**
 * First-run setup API client. The setup surface lives at /api/setup/v1
 * (separate from the admin API), and the bootstrap secret travels only in the
 * X-Vibress-Setup-Token header — never in a JSON body.
 */

export const SETUP_TOKEN_HEADER = "X-Vibress-Setup-Token";

export interface SetupStatus {
  installed: boolean;
}

export interface SetupPreflight {
  ready: boolean;
  database: boolean;
  redis: boolean;
  configuration: boolean;
}

export interface SetupCompletePayload {
  site: { name: string; description: string; tagline?: string; locale: string };
  owner: { name: string; email: string; password: string };
}

export interface SetupCompleteResult {
  installed: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    slug?: string | null;
    roles: string[];
    permissions: string[];
  } | null;
}

async function setupRequest<T>(
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/setup/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { [SETUP_TOKEN_HEADER]: token } : {}),
      ...init.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorDetail =
      (data as { errors?: Array<{ code?: string; message?: string }> })
        .errors?.[0] || {};
    const err = new Error(
      errorDetail.message || "An unexpected error occurred",
    );
    (err as Error & { code?: string; statusCode?: number }).code =
      errorDetail.code || "UNKNOWN_ERROR";
    (err as Error & { statusCode?: number }).statusCode = response.status;
    throw err;
  }
  return data as T;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  return setupRequest<SetupStatus>("/status", undefined);
}

export async function fetchSetupPreflight(
  token: string,
): Promise<SetupPreflight> {
  return setupRequest<SetupPreflight>("/preflight", token);
}

export async function completeSetup(
  token: string,
  payload: SetupCompletePayload,
): Promise<SetupCompleteResult> {
  return setupRequest<SetupCompleteResult>("/complete", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
