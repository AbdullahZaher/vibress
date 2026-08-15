/**
 * Vibress Health & Readiness Probe Script
 * Used by Docker container HEALTHCHECK instructions and deployment orchestrators.
 */
const API_URL = process.env.API_URL || "http://127.0.0.1:3000/health";
const TIMEOUT_MS = 5000;

async function checkHealth(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, { signal: controller.signal });
    if (!res.ok) {
      console.error(`Health check failed with status: ${res.status}`);
      process.exit(1);
    }
    const data = (await res.json()) as { status?: string };
    if (data.status !== "ok" && data.status !== "ready") {
      console.error(`Health check returned non-ready payload:`, data);
      process.exit(1);
    }
    console.log("Health check PASSED:", data);
    process.exit(0);
  } catch (err) {
    console.error("Health check error:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

void checkHealth();
