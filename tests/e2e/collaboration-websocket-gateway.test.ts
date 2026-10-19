import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { seedFixturePost } from "@vibress/database";

const BASE_URL = "http://localhost:7777";
const POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";
const WS_URL = `ws://localhost:7777/api/admin/v1/posts/${POST_ID}/collaboration/ws`;

test.describe("Collaboration WebSocket gateway and authorization", () => {
  test("forwards a genuine authenticated Upgrade through Nginx to Fastify", async ({
    request,
  }) => {
    await seedFixturePost();
    const login = await request.post(`${BASE_URL}/api/admin/v1/auth/login`, {
      headers: { Origin: BASE_URL },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    expect(login.status()).toBe(200);

    // Use actual server-issued cookies; neither bypass auth nor mint tokens.
    const session = await request.storageState();
    const cookie = session.cookies
      .filter((c) => c.domain === "localhost" || c.domain === "127.0.0.1")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    expect(cookie.length).toBeGreaterThan(0);

    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(WS_URL, {
        headers: { Cookie: cookie, Origin: BASE_URL },
        handshakeTimeout: 10000,
      });
      ws.once("open", () => {
        ws.close(1000);
        resolve(101);
      });
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        reject(new Error(`Collaboration WebSocket gateway returned HTTP ${response.statusCode}`));
      });
      ws.once("error", reject);
    });
    expect(status).toBe(101);
  });

  test("rejects anonymous WebSocket upgrade without leaking a document", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(WS_URL, {
        headers: { Origin: BASE_URL },
        handshakeTimeout: 10000,
      });
      ws.once("open", () => {
        ws.close(1000);
        reject(new Error("Unauthenticated collaboration socket was accepted"));
      });
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      ws.once("error", reject);
    });
    expect(status).toBe(401);
  });
});
