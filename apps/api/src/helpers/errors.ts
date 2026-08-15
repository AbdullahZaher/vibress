/**
 * A standard Error that may carry a `code` string (used by domain errors
 * throughout the platform). Helps narrow `unknown` values from catch blocks.
 */
export type CodedError = Error & { code?: string };

/**
 * Narrow an unknown caught value into a CodedError so that `.code` and
 * `.message` are safely accessible without using `any`.
 */
export function asCodedError(err: unknown): CodedError {
  if (err instanceof Error) return err as CodedError;
  return new Error(
    typeof err === "string" ? err : "Unknown error",
  ) as CodedError;
}

/**
 * Return the human-readable message of a caught value.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}
