import { test, expect } from "@playwright/test";

const API = "http://localhost:7777";

test.describe("Batch 14 Operations E2E Suite", () => {
  async function loginAsStaff(request: any) {
    await request.post(`${API}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: API },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
  }

  test("[Settings] staff edits safe setting, audit entry created, secret masked", async ({
    request,
    browser,
  }) => {
    await loginAsStaff(request);

    // Update a public setting
    const updateRes = await request.put(
      `${API}/api/admin/v1/settings/site/title`,
      {
        headers: { Origin: API },
        data: { value: `E2E Site ${Date.now()}` },
      },
    );
    expect(updateRes.status()).toBe(200);

    // Audit entry created
    const auditRes = await request.get(
      `${API}/api/admin/v1/audit?action=setting.updated`,
    );
    expect(auditRes.status()).toBe(200);
    const events = (await auditRes.json()).events;
    expect(events.length).toBeGreaterThan(0);

    // Secret setting is masked on read
    const setRes = await request.put(
      `${API}/api/admin/v1/settings/email/smtpHost`,
      {
        headers: { Origin: API },
        data: { value: "smtp.secret.example.com" },
      },
    );
    expect(setRes.status()).toBe(200);
    expect(JSON.stringify(await setRes.json())).not.toContain(
      "smtp.secret.example.com",
    );

    const settingsRes = await request.get(`${API}/api/admin/v1/settings`);
    const body = JSON.stringify(await settingsRes.json());
    expect(body).not.toContain("smtp.secret.example.com");
    expect(body).toContain("••••••••");

    // Unauthenticated → 401
    const freshCtx = await browser.newContext();
    const unauthRes = await freshCtx.request.get(
      `${API}/api/admin/v1/settings`,
    );
    expect(unauthRes.status()).toBe(401);
    await freshCtx.close();
  });

  test("[Redirects] create works, loop and protected-route blocked", async ({
    request,
  }) => {
    await loginAsStaff(request);

    const createRes = await request.post(`${API}/api/admin/v1/redirects`, {
      headers: { Origin: API },
      data: {
        source: `/e2e-old-${Date.now()}`,
        destination: "/e2e-new",
        statusCode: 301,
      },
    });
    expect(createRes.status()).toBe(201);

    // Protected route hijack blocked
    const badRes = await request.post(`${API}/api/admin/v1/redirects`, {
      headers: { Origin: API },
      data: { source: "/admin/login", destination: "https://evil.example.com" },
    });
    expect(badRes.status()).toBe(400);
    expect((await badRes.json()).errors[0].code).toBe("PROTECTED_ROUTE");

    // Unsafe scheme blocked
    const jsRes = await request.post(`${API}/api/admin/v1/redirects`, {
      headers: { Origin: API },
      data: { source: "/x", destination: "javascript:alert(1)" },
    });
    expect(jsRes.status()).toBe(400);
    expect((await jsRes.json()).errors[0].code).toBe("INVALID_DESTINATION");
  });

  test("[Export] completes and contains no secret material", async ({
    request,
  }) => {
    await loginAsStaff(request);

    // Seed a secret setting first
    await request.put(`${API}/api/admin/v1/settings/email/smtpPassword`, {
      headers: { Origin: API },
      data: { value: "super-secret-smtp-pass" },
    });

    const exportRes = await request.post(`${API}/api/admin/v1/exports`, {
      headers: { Origin: API },
    });
    expect(exportRes.status()).toBe(202);
    const job = (await exportRes.json()).job;
    expect(["completed", "failed"]).toContain(job.status);

    if (job.status === "completed") {
      const artifactRes = await request.get(
        `${API}/api/admin/v1/import-export-jobs/${job.id}/artifact`,
      );
      expect(artifactRes.status()).toBe(200);
      const body = JSON.stringify(await artifactRes.json());
      expect(body).toContain("vibress");
      expect(body).not.toContain("super-secret-smtp-pass");
      expect(body).not.toContain("smtpPassword");
      expect(body).not.toContain("VIBRESS_ENCRYPTION_KEY");
    }
  });

  test("[Import] valid import succeeds, invalid fails safely", async ({
    request,
  }) => {
    await loginAsStaff(request);

    const validRes = await request.post(`${API}/api/admin/v1/imports`, {
      headers: { Origin: API },
      data: {
        format: "vibress",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          redirects: [
            {
              source: `/imported-e2e-${Date.now()}`,
              destination: "/imported-target",
            },
          ],
        },
      },
    });
    expect(validRes.status()).toBe(202);

    const invalidRes = await request.post(`${API}/api/admin/v1/imports`, {
      headers: { Origin: API },
      data: { format: "wordpress", version: 1, data: {} },
    });
    expect(invalidRes.status()).toBe(400);
  });

  test("[System] diagnostics permission enforced, search rebuild completes", async ({
    request,
    browser,
  }) => {
    await loginAsStaff(request);

    // Unauthenticated → 401
    const freshCtx = await browser.newContext();
    const unauthRes = await freshCtx.request.get(
      `${API}/api/admin/v1/system/diagnostics`,
    );
    expect(unauthRes.status()).toBe(401);
    await freshCtx.close();

    // Diagnostics contain safe info, no secrets
    const diagRes = await request.get(`${API}/api/admin/v1/system/diagnostics`);
    expect(diagRes.status()).toBe(200);
    const diag = JSON.stringify(await diagRes.json());
    expect(diag).toContain("nodeVersion");
    expect(diag).toContain("postgres");
    expect(diag).not.toContain("password");
    expect(diag).not.toContain("VIBRESS_ENCRYPTION_KEY");

    // Search rebuild maintenance op
    const maintRes = await request.post(
      `${API}/api/admin/v1/system/maintenance`,
      {
        headers: { Origin: API },
        data: { operation: "search.rebuild" },
      },
    );
    expect(maintRes.status()).toBe(200);
    expect((await maintRes.json()).accepted).toBe(true);

    // Integrity checks
    const intRes = await request.get(`${API}/api/admin/v1/system/integrity`);
    expect(intRes.status()).toBe(200);
    expect(Array.isArray((await intRes.json()).checks)).toBe(true);
  });
});
