import crypto from "node:crypto";

interface BenchmarkResult {
  endpoint: string;
  samples: number;
  throughputRps: number;
  errorRatePercent: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function calculatePercentile(latencies: number[], p: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.min(
    Math.floor((p / 100) * sorted.length),
    sorted.length - 1,
  );
  return Number(sorted[idx]?.toFixed(2));
}

async function benchmarkEndpoint(
  name: string,
  url: string,
  options: RequestInit = {},
  durationSeconds = 3,
  concurrency = 10,
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  let errorCount = 0;
  let successCount = 0;

  const endTime = Date.now() + durationSeconds * 1000;

  async function worker() {
    while (Date.now() < endTime) {
      const start = performance.now();
      try {
        const res = await fetch(url, options);
        const duration = performance.now() - start;
        latencies.push(duration);
        if (res.status >= 200 && res.status < 500) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const total = successCount + errorCount;
  const elapsedSec = durationSeconds;
  const throughputRps = Number((total / elapsedSec).toFixed(1));
  const errorRatePercent = Number(((errorCount / Math.max(1, total)) * 100).toFixed(2));

  return {
    endpoint: name,
    samples: total,
    throughputRps,
    errorRatePercent,
    p50Ms: calculatePercentile(latencies, 50),
    p95Ms: calculatePercentile(latencies, 95),
    p99Ms: calculatePercentile(latencies, 99),
  };
}

async function run() {
  console.log("==========================================================");
  console.log("  VIBRESS REPRESENTATIVE PRODUCTION HTTP LOAD BENCHMARK   ");
  console.log("==========================================================");

  // 1. Authenticate Staff for Admin endpoint
  const loginRes = await fetch("http://localhost:7777/api/admin/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:7777" },
    body: JSON.stringify({ email: "owner@example.com", password: "OwnerPass123!" }),
  });
  const cookie = loginRes.headers.get("set-cookie") || "";

  // 2. Setup Webhook signature
  const webhookSecret = "whsec_test_secret_for_load";
  const webhookBody = JSON.stringify({
    id: "evt_load_test",
    type: "invoice.paid",
    data: { object: { customer: "cus_123", amount_paid: 1000 } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signaturePayload = `${timestamp}.${webhookBody}`;
  const hmac = crypto.createHmac("sha256", webhookSecret).update(signaturePayload).digest("hex");
  const stripeHeader = `t=${timestamp},v1=${hmac}`;

  const results: BenchmarkResult[] = [];

  // Bench 1: Public Content Read
  console.log("\n[1/5] Benchmarking Public Content Read (GET /api/content/v1/posts)...");
  results.push(
    await benchmarkEndpoint(
      "Public Content Read",
      "http://localhost:7777/api/content/v1/posts",
      { headers: { Origin: "http://localhost:7777" } },
    ),
  );

  // Bench 2: Admin Authenticated Read
  console.log("[2/5] Benchmarking Admin Content Read (GET /api/admin/v1/posts)...");
  results.push(
    await benchmarkEndpoint(
      "Admin Authenticated Read",
      "http://localhost:7777/api/admin/v1/posts",
      { headers: { Origin: "http://localhost:7777", Cookie: cookie } },
    ),
  );

  // Bench 3: Search Querying
  console.log("[3/5] Benchmarking Search Querying (GET /api/content/v1/search?q=test)...");
  results.push(
    await benchmarkEndpoint(
      "Search Querying",
      "http://localhost:7777/api/content/v1/search?q=test",
      { headers: { Origin: "http://localhost:7777" } },
    ),
  );

  // Bench 4: Member Magic Link Intake
  console.log("[4/5] Benchmarking Member Auth Magic Link Intake (POST /api/portal/v1/auth/send-magic-link)...");
  results.push(
    await benchmarkEndpoint(
      "Member Magic Link Intake",
      "http://localhost:7777/api/portal/v1/auth/send-magic-link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:7777" },
        body: JSON.stringify({ email: "member-load@example.com" }),
      },
    ),
  );

  // Bench 5: Webhook Intake
  console.log("[5/5] Benchmarking Webhook HMAC Intake (POST /api/webhooks/v1/stripe)...");
  results.push(
    await benchmarkEndpoint(
      "Webhook HMAC Intake",
      "http://localhost:7777/api/webhooks/v1/stripe",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
          "stripe-signature": stripeHeader,
        },
        body: webhookBody,
      },
    ),
  );

  console.log("\n==========================================================");
  console.log("                  LOAD BENCHMARK SUMMARY                  ");
  console.log("==========================================================");
  console.table(results);
}

run();
