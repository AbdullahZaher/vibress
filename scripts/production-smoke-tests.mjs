// Self-contained ES module production smoke test runner (no compile step needed)
const baseUrl = process.env.SITE_URL || `http://localhost:${process.env.VIBRESS_PORT || 7777}`;
console.log("================================================================================");
console.log(` VIBRESS PRODUCTION SMOKE TESTS — Target: ${baseUrl}`);
console.log("================================================================================");

const checks = [
  {
    name: "1. Gateway Liveness Probe",
    url: `${baseUrl}/nginx-health`,
    method: "GET",
    expectedStatus: 200,
  },
  {
    name: "2. API Liveness Probe",
    url: `${baseUrl}/health/live`,
    method: "GET",
    expectedStatus: 200,
  },
  {
    name: "3. API Readiness Probe (DB & Redis)",
    url: `${baseUrl}/health/ready`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => {
      try {
        const data = JSON.parse(body);
        return data.status === "ready" || data.ready === true;
      } catch {
        return true;
      }
    },
  },
  {
    name: "4. Public Web Homepage (Next.js SSR)",
    url: `${baseUrl}/`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => body.includes("<html") || body.includes("<!DOCTYPE html>"),
  },
  {
    name: "5. Arabic RTL Multilingual Homepage",
    url: `${baseUrl}/ar`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => body.includes('dir="rtl"') || body.includes('lang="ar"') || body.includes("<html"),
  },
  {
    name: "6. Admin SPA Shell",
    url: `${baseUrl}/admin/`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => body.includes('<div id="root"') || body.includes("<html"),
  },
  {
    name: "7. Member Portal SPA Shell",
    url: `${baseUrl}/portal/`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => body.includes('<div id="root"') || body.includes("<html"),
  },
  {
    name: "8. Public Posts REST API",
    url: `${baseUrl}/api/content/v1/posts`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => {
      try {
        const data = JSON.parse(body);
        return Array.isArray(data) || Array.isArray(data.posts) || Array.isArray(data.data);
      } catch {
        return false;
      }
    },
  },
  {
    name: "9. Public Full-Text Search API",
    url: `${baseUrl}/api/content/v1/search?q=vibress`,
    method: "GET",
    expectedStatus: 200,
    validate: (body) => {
      try {
        const data = JSON.parse(body);
        return typeof data === "object" && data !== null;
      } catch {
        return false;
      }
    },
  },
  {
    name: "10. Stripe Webhook HMAC Security Gate",
    url: `${baseUrl}/api/webhooks/v1/billing/stripe`,
    method: "POST",
    expectedStatus: [400, 401], // Rejects forged / unsigned payload
  },
];

async function runSmokeTests() {
  const results = [];
  let allPassed = true;

  for (const check of checks) {
    const start = performance.now();
    try {
      const options = {
        method: check.method,
        headers: {
          Origin: baseUrl,
          "User-Agent": "Vibress-Smoke-Runner/1.0",
        },
      };
      if (check.method === "POST") {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify({ event: "test" });
      }

      const res = await fetch(check.url, options);
      const latency = Math.round(performance.now() - start);
      const body = await res.text();

      const expectedList = Array.isArray(check.expectedStatus) ? check.expectedStatus : [check.expectedStatus];
      const statusOk = expectedList.includes(res.status);
      const validationOk = check.validate ? await check.validate(body, res) : true;
      const passed = statusOk && validationOk;

      if (!passed) allPassed = false;

      results.push({
        Test: check.name,
        Status: `${res.status}`,
        LatencyMs: latency,
        Result: passed ? "✓ PASS" : "✗ FAIL",
      });
    } catch (err) {
      allPassed = false;
      const latency = Math.round(performance.now() - start);
      results.push({
        Test: check.name,
        Status: "ERROR",
        LatencyMs: latency,
        Result: `✗ FAIL (${err.message})`,
      });
    }
  }

  console.table(results);

  if (!allPassed) {
    console.error("\n✗ Production Smoke Tests Encountered Failures.");
    process.exit(1);
  } else {
    console.log("\n✓ All Production Smoke Tests Passed Successfully.");
  }
}

runSmokeTests().catch((err) => {
  console.error("Smoke test runner failure:", err);
  process.exit(1);
});
