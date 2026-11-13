import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/verify-site-password/route";

function request(password = "site-password"): NextRequest {
  return new NextRequest("http://localhost:7778/api/verify-site-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/verify-site-password", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the API-signed site auth cookie", async () => {
    const setCookie =
      "vb_site_auth=v2.1700000000000.cHViX3Rlc3Q.signature; Path=/; HttpOnly";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, private: true }),
      headers: new Headers({ "set-cookie": setCookie }),
    }) as any;

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("vb_site_auth=");
  });

  it("fails closed instead of minting a cookie with a shared fallback secret", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, private: true }),
      headers: new Headers(),
    }) as any;

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect((await res.json()).valid).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
