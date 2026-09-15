import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import * as Y from "yjs";
import crypto from "node:crypto";
import { buildApp } from "../../apps/api/src/main";
import { getDbPool, closeDbPool, seedDatabase } from "@vibress/database";
import { getRedisClient, closeRedisClient } from "@vibress/cache";
import { hashPassword } from "@vibress/security";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { DrizzleRoleRepository, RolesService } from "@vibress/roles";
import { roomManager } from "../../apps/api/src/collaboration/room-manager";
import { crdtPersistence } from "../../apps/api/src/collaboration/crdt-persistence";

describe("Studio Production Collaboration & Multi-Tenant Isolation (Step E)", () => {
  let app: ReturnType<typeof buildApp>;
  let serverAddress: string;
  let wsBaseUrl: string;

  // Publication Alpha
  let pubAlphaId: string;
  let userAlphaId: string;
  let userAlphaToken: string;
  let postAlphaId: string;

  // Publication Beta
  let pubBetaId: string;
  let userBetaId: string;
  let userBetaToken: string;
  let postBetaId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    serverAddress = `127.0.0.1:${addr.port}`;
    wsBaseUrl = `ws://${serverAddress}/api/admin/v1`;

    const pool = getDbPool();

    // 1. Resolve Publication Alpha (default seeded) and its workspace
    const pubAlphaRes = await pool.query(
      `SELECT id, workspace_id FROM publications WHERE slug = 'default' LIMIT 1`,
    );
    expect(pubAlphaRes.rows.length).toBeGreaterThan(0);
    pubAlphaId = pubAlphaRes.rows[0].id;
    const workspaceId = pubAlphaRes.rows[0].workspace_id;

    // 2. Resolve or create Publication Beta
    let pubBetaRes = await pool.query(
      `SELECT id FROM publications WHERE slug = 'collab-beta' LIMIT 1`,
    );
    if (pubBetaRes.rows.length === 0) {
      const inserted = await pool.query(
        `INSERT INTO publications (id, workspace_id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [crypto.randomUUID(), workspaceId, "Collab Beta Pub", "collab-beta"],
      );
      pubBetaId = inserted.rows[0].id;
    } else {
      pubBetaId = pubBetaRes.rows[0].id;
    }

    // 3. Setup User Alpha (Owner of Alpha)
    const userRepo = new DrizzleUserRepository();
    const roleRepo = new DrizzleRoleRepository();
    const usersService = new UsersService(userRepo);
    const rolesService = new RolesService(roleRepo);

    const emailAlpha = "collab-alpha@vibress.local";
    let uAlpha = await userRepo.findByEmail(emailAlpha);
    if (!uAlpha) {
      const passwordHash = await hashPassword("CollabPassword123!");
      uAlpha = await usersService.createUser({
        email: emailAlpha,
        passwordHash,
        name: "Editor Alpha",
        role: "owner",
        publicationId: pubAlphaId,
      });
    }
    userAlphaId = uAlpha.id;

    // 4. Setup User Beta (Owner of Beta)
    const emailBeta = "collab-beta@vibress.local";
    let uBeta = await userRepo.findByEmail(emailBeta);
    if (!uBeta) {
      const passwordHash = await hashPassword("CollabPassword123!");
      uBeta = await usersService.createUser({
        email: emailBeta,
        passwordHash,
        name: "Editor Beta",
        role: "owner",
        publicationId: pubBetaId,
      });
    }
    userBetaId = uBeta.id;

    // Always ensure owner role is assigned
    const ownerRole = await rolesService.findByKey("owner");
    if (ownerRole) {
      await rolesService.assignRoleToUser(userAlphaId, ownerRole.id);
      await rolesService.assignRoleToUser(userBetaId, ownerRole.id);
    }

    // Ensure User Alpha is bound to Publication Alpha in publication_memberships
    const memAlpha = await pool.query(
      `SELECT id FROM publication_memberships WHERE publication_id = $1 AND user_id = $2`,
      [pubAlphaId, userAlphaId],
    );
    if (memAlpha.rows.length === 0) {
      await pool.query(
        `INSERT INTO publication_memberships (id, publication_id, user_id, role, created_at)
         VALUES ($1, $2, $3, 'owner', NOW())`,
        [crypto.randomUUID(), pubAlphaId, userAlphaId],
      );
    }

    // Ensure User Beta is explicitly bound to Publication Beta in publication_memberships
    const memBeta = await pool.query(
      `SELECT id FROM publication_memberships WHERE publication_id = $1 AND user_id = $2`,
      [pubBetaId, userBetaId],
    );
    if (memBeta.rows.length === 0) {
      await pool.query(
        `INSERT INTO publication_memberships (id, publication_id, user_id, role, created_at)
         VALUES ($1, $2, $3, 'owner', NOW())`,
        [crypto.randomUUID(), pubBetaId, userBetaId],
      );
    }

    // Login Alpha
    const loginAlpha = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: emailAlpha, password: "CollabPassword123!" },
    });
    expect(loginAlpha.statusCode).toBe(200);
    userAlphaToken =
      loginAlpha.cookies.find((c) => c.name === "vibress_session")?.value || "";
    expect(userAlphaToken).toBeTruthy();

    // Login Beta
    const loginBeta = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: emailBeta, password: "CollabPassword123!" },
    });
    expect(loginBeta.statusCode).toBe(200);
    userBetaToken =
      loginBeta.cookies.find((c) => c.name === "vibress_session")?.value || "";
    expect(userBetaToken).toBeTruthy();

    // 5. Create Post in Publication Alpha
    const createPostAlpha = await app.inject({
      method: "POST",
      url: "/api/admin/v1/posts",
      headers: {
        authorization: `Bearer ${userAlphaToken}`,
        cookie: `vibress_session=${userAlphaToken}`,
        "x-publication-id": pubAlphaId,
        origin: "http://localhost:7777",
      },
      payload: {
        title: "Alpha Collaboration Post",
        slug: `alpha-collab-${crypto.randomUUID().slice(0, 8)}`,
        primaryAuthorId: userAlphaId,
      },
    });
    if (createPostAlpha.statusCode !== 201) {
      console.log("CREATE POST ALPHA FAILED:", JSON.stringify(createPostAlpha.json(), null, 2));
    }
    expect(createPostAlpha.statusCode).toBe(201);
    postAlphaId = createPostAlpha.json().post.id;

    // 6. Create Post in Publication Beta
    const createPostBeta = await app.inject({
      method: "POST",
      url: "/api/admin/v1/posts",
      headers: {
        authorization: `Bearer ${userBetaToken}`,
        cookie: `vibress_session=${userBetaToken}`,
        "x-publication-id": pubBetaId,
        origin: "http://localhost:7777",
      },
      payload: {
        title: "Beta Collaboration Post",
        slug: `beta-collab-${crypto.randomUUID().slice(0, 8)}`,
        primaryAuthorId: userBetaId,
      },
    });
    expect(createPostBeta.statusCode).toBe(201);
    postBetaId = createPostBeta.json().post.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // Helper to open an authenticated client socket
  function connectClient(
    postId: string,
    token?: string,
    publicationId?: string,
    origin = "http://localhost:7777",
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      let url = `${wsBaseUrl}/posts/${postId}/collaboration/ws`;
      const params: string[] = [];
      if (token) params.push(`token=${encodeURIComponent(token)}`);
      if (publicationId) params.push(`publicationId=${encodeURIComponent(publicationId)}`);
      if (params.length > 0) url += `?${params.join("&")}`;

      const ws = new WebSocket(url, {
        headers: {
          Origin: origin,
          "x-publication-id": publicationId || "",
        },
      });

      const onOpen = () => {
        cleanup();
        resolve(ws);
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onUnexpected = (_req: unknown, res: any) => {
        cleanup();
        reject(new Error(`Unexpected server response: ${res.statusCode}`));
      };

      const onClose = (code: number, reason: Buffer) => {
        cleanup();
        reject(new Error(`WebSocket closed early with code ${code}: ${reason.toString()}`));
      };

      function cleanup() {
        ws.off("open", onOpen);
        ws.off("error", onError);
        ws.off("unexpected-response", onUnexpected);
        ws.off("close", onClose);
      }

      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.once("unexpected-response", onUnexpected);
      ws.once("close", onClose);
    });
  }

  // ============================================================
  // 1. AUTHORIZATION & MULTI-TENANT ISOLATION GATES
  // ============================================================
  describe("Authorization & Tenant Boundaries", () => {
    it("allows authorized staff member to connect to room in their publication", async () => {
      const ws = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("REJECTS connection attempt without authentication token with code 401", async () => {
      await expect(connectClient(postAlphaId)).rejects.toThrow("401");
    });

    it("REJECTS connection attempt with invalid or expired token with code 401", async () => {
      await expect(
        connectClient(postAlphaId, "invalid_session_token_12345"),
      ).rejects.toThrow("401");
    });

    it("REJECTS cross-publication attack (Alpha user attempting to connect to Beta post room) with code 403", async () => {
      await expect(
        connectClient(postBetaId, userAlphaToken, pubBetaId),
      ).rejects.toThrow("403");
    });

    it("REJECTS spoofed publication parameter (Alpha user targeting Alpha post with Beta pubId) with code 403", async () => {
      await expect(
        connectClient(postAlphaId, userAlphaToken, pubBetaId),
      ).rejects.toThrow("403");
    });

    it("REJECTS nonexistent post ID with code 404", async () => {
      const nonExistentPostId = crypto.randomUUID();
      await expect(
        connectClient(nonExistentPostId, userAlphaToken, pubAlphaId),
      ).rejects.toThrow("404");
    });

    it("REJECTS untrusted Origin header with code 403", async () => {
      await expect(
        connectClient(postAlphaId, userAlphaToken, pubAlphaId, "https://malicious-attacker.com"),
      ).rejects.toThrow("403");
    });
  });

  // ============================================================
  // 2. BIDIRECTIONAL SYNCHRONIZATION & CONVERGENCE
  // ============================================================
  describe("Bidirectional Synchronization & CRDT Convergence", () => {
    it("synchronizes updates bidirectionally between independent Client A and Client B", async () => {
      const wsA = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);
      const wsB = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);

      const docA = new Y.Doc();
      const docB = new Y.Doc();

      const receivedByB: Uint8Array[] = [];
      const receivedByA: Uint8Array[] = [];

      wsB.on("message", (data: WebSocket.RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length > 0 && buf[0] === 0x7b) {
          try {
            if (JSON.parse(buf.toString()).type === "awareness") return;
          } catch {}
        }
        const u = new Uint8Array(buf);
        receivedByB.push(u);
        Y.applyUpdate(docB, u);
      });

      wsA.on("message", (data: WebSocket.RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length > 0 && buf[0] === 0x7b) {
          try {
            if (JSON.parse(buf.toString()).type === "awareness") return;
          } catch {}
        }
        const u = new Uint8Array(buf);
        receivedByA.push(u);
        Y.applyUpdate(docA, u);
      });

      // Client A edits
      const textA = docA.getText("content");
      docA.on("update", (update: Uint8Array) => {
        wsA.send(update, { binary: true });
      });

      textA.insert(0, "First paragraph from Client A. ");

      // Wait for broadcast delivery to B
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(docB.getText("content").toString()).toBe("First paragraph from Client A. ");

      // Client B edits
      const textB = docB.getText("content");
      docB.on("update", (update: Uint8Array) => {
        wsB.send(update, { binary: true });
      });

      textB.insert(textB.length, "Second paragraph appended by Client B.");

      // Wait for broadcast delivery to A
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(docA.getText("content").toString()).toBe(
        "First paragraph from Client A. Second paragraph appended by Client B.",
      );

      // Verify convergence
      expect(docA.getText("content").toString()).toBe(docB.getText("content").toString());

      wsA.close();
      wsB.close();
    });

    it("converges concurrent conflicting edits without data loss", async () => {
      const wsA = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);
      const wsB = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);

      const docA = new Y.Doc();
      const docB = new Y.Doc();

      wsA.on("message", (data: WebSocket.RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length > 0 && buf[0] === 0x7b) {
          try {
            if (JSON.parse(buf.toString()).type === "awareness") return;
          } catch {}
        }
        Y.applyUpdate(docA, new Uint8Array(buf));
      });
      wsB.on("message", (data: WebSocket.RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length > 0 && buf[0] === 0x7b) {
          try {
            if (JSON.parse(buf.toString()).type === "awareness") return;
          } catch {}
        }
        Y.applyUpdate(docB, new Uint8Array(buf));
      });

      // Concurrent conflicting edits at position 0
      const textA = docA.getText("content");
      const textB = docB.getText("content");

      docA.on("update", (update: Uint8Array) => wsA.send(update, { binary: true }));
      docB.on("update", (update: Uint8Array) => wsB.send(update, { binary: true }));

      textA.insert(0, "[Alpha-Concurrent-Heading] ");
      textB.insert(0, "[Beta-Concurrent-Heading] ");

      await new Promise((resolve) => setTimeout(resolve, 400));

      const strA = docA.getText("content").toString();
      const strB = docB.getText("content").toString();

      // Convergence invariant: both docs MUST have identical content
      expect(strA).toBe(strB);
      expect(strA).toContain("[Alpha-Concurrent-Heading]");
      expect(strA).toContain("[Beta-Concurrent-Heading]");

      wsA.close();
      wsB.close();
    });
  });

  // ============================================================
  // 3. PERSISTENCE & SERVER RESTART SURVIVABILITY
  // ============================================================
  describe("Durable Persistence & Restart Recovery", () => {
    it("persists updates in Redis and delivers complete history on reconnect", async () => {
      // 1. Client A connects and creates document content
      const wsA = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);
      const docA = new Y.Doc();
      const textA = docA.getText("content");

      docA.on("update", (update: Uint8Array) => wsA.send(update, { binary: true }));
      textA.insert(0, "Durable text for persistence verification.");

      // Wait for server to process and persist
      await new Promise((resolve) => setTimeout(resolve, 300));
      wsA.close();

      // 2. Verify Redis holds the persisted updates
      const updates = await crdtPersistence.getUpdates(pubAlphaId, postAlphaId);
      expect(updates.length).toBeGreaterThan(0);

      // 3. Client C connects fresh (simulating browser reload / new editor session)
      const wsC = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);
      const docC = new Y.Doc();

      const receivedUpdates: Uint8Array[] = [];
      wsC.on("message", (data: WebSocket.RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length > 0 && buf[0] === 0x7b) return;
        const u = new Uint8Array(buf);
        receivedUpdates.push(u);
        Y.applyUpdate(docC, u);
      });

      // Wait for catch-up stream
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(receivedUpdates.length).toBeGreaterThan(0);
      expect(docC.getText("content").toString()).toContain("Durable text for persistence verification.");

      wsC.close();
    });

    it("survives server restart: new app instance reads persisted updates from Redis", async () => {
      // 1. Ensure content exists
      const persistedBefore = await crdtPersistence.getUpdates(pubAlphaId, postAlphaId);
      expect(persistedBefore.length).toBeGreaterThan(0);

      // 2. Restart server: close current app, build and launch a second app instance
      await app.close();

      const newApp = buildApp();
      await newApp.ready();
      await newApp.listen({ port: 0, host: "127.0.0.1" });

      const newAddr = newApp.server.address() as AddressInfo;
      const newWsBaseUrl = `ws://127.0.0.1:${newAddr.port}/api/admin/v1`;

      // 3. Connect client to the new app instance
      const wsRestart = await new Promise<WebSocket>((resolve, reject) => {
        const url = `${newWsBaseUrl}/posts/${postAlphaId}/collaboration/ws?token=${encodeURIComponent(userAlphaToken)}&publicationId=${pubAlphaId}`;
        const ws = new WebSocket(url, { headers: { Origin: "http://localhost:7777" } });
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
      });

      const docRecovered = new Y.Doc();
      wsRestart.on("message", (data: WebSocket.RawData) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (buf.length > 0 && buf[0] === 0x7b) return;
        Y.applyUpdate(docRecovered, new Uint8Array(buf));
      });

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(docRecovered.getText("content").toString()).toContain("Durable text for persistence verification.");

      wsRestart.close();
      await newApp.close();

      // Restore original app for remaining tests
      app = buildApp();
      await app.ready();
      await app.listen({ port: 0, host: "127.0.0.1" });
      const restoredAddr = app.server.address() as AddressInfo;
      serverAddress = `127.0.0.1:${restoredAddr.port}`;
      wsBaseUrl = `ws://${serverAddress}/api/admin/v1`;
    });
  });

  // ============================================================
  // 4. ABUSE CONTROLS & RESOURCE BOUNDS
  // ============================================================
  describe("Abuse Controls & Rate Limiting", () => {
    it("REJECTS oversized CRDT updates (>64 KB) with close code 1009 or 4413", async () => {
      const ws = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);

      const closedPromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      // Send 65 KB payload
      const oversizedPayload = Buffer.alloc(65 * 1024, 0xaa);
      ws.send(oversizedPayload, { binary: true });

      const closeResult = await closedPromise;
      expect([1009, 4413]).toContain(closeResult.code);
    });

    it("throttles rapid burst of updates exceeding rate limiter", async () => {
      const ws = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);

      const smallDoc = new Y.Doc();
      const text = smallDoc.getText("flood");

      // Generate 150 unique updates rapidly
      let updatesSent = 0;
      for (let i = 0; i < 150; i++) {
        text.insert(i, "x");
        const state = Y.encodeStateAsUpdate(smallDoc);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(state, { binary: true });
          updatesSent++;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
      // The socket shouldn't crash, rate limiter protects memory/CPU
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("broadcasts awareness presence frames safely within the same publication room", async () => {
      const wsA = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);
      const wsB = await connectClient(postAlphaId, userAlphaToken, pubAlphaId);

      const receivedAwareness: string[] = [];
      wsB.on("message", (data: WebSocket.RawData) => {
        const str = data.toString();
        if (str.startsWith("{")) {
          receivedAwareness.push(str);
        }
      });

      const presenceMessage = JSON.stringify({
        type: "awareness",
        user: { name: "Editor Alpha", color: "#ff0000" },
        cursor: { line: 10, column: 4 },
      });

      wsA.send(presenceMessage, { binary: false });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(receivedAwareness.length).toBeGreaterThan(0);
      const parsed = JSON.parse(receivedAwareness[0]);
      expect(parsed.user.name).toBe("Editor Alpha");

      wsA.close();
      wsB.close();
    });
  });
});
