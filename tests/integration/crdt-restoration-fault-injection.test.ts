import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/main";
import { getDbPool, closeDbPool } from "@vibress/database";
import { getRedisClient, closeRedisClient, buildPublicationCacheKey } from "@vibress/cache";
import { hashPassword } from "@vibress/security";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { DrizzleRoleRepository, RolesService } from "@vibress/roles";
import { createDefaultStudioDocument, migrateDocument } from "@vibress/studio-core";
import { roomManager } from "../../apps/api/src/collaboration/room-manager";
import {
  crdtPersistence,
  type RedisClientLike,
  type RedisPipelineLike,
} from "../../apps/api/src/collaboration/crdt-persistence";

interface PostPayload {
  id: string;
  version: number;
  title: string;
  content: unknown;
}

interface RevisionPayload {
  id: string;
  versionNumber?: number;
}

interface WsControlFrame {
  type: string;
  epoch?: number;
  generationId?: string;
  challengeNonce?: string;
  content?: unknown;
  restoredContent?: unknown;
}

function extractPlainText(rawContent: unknown): string {
  const doc = migrateDocument(rawContent);
  return JSON.stringify(doc);
}

describe("CR-01 — Guaranteed Yjs Revision Restoration Durability & Fault Injection (18 Mandatory Scenarios)", () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;
  let publicationId: string;
  let authorId: string;
  let sessionToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as AddressInfo;
    wsBaseUrl = `ws://127.0.0.1:${addr.port}/api/admin/v1`;

    const pool = getDbPool();
    const pubRes = await pool.query<{ id: string }>(
      "SELECT id FROM publications WHERE slug = 'default' LIMIT 1",
    );
    expect(pubRes.rows[0]).toBeDefined();
    publicationId = pubRes.rows[0]!.id;

    const email = `cr01-fault-${randomUUID()}@vibress.local`;
    const password = `Cr01Pass-${randomUUID()}!`;
    const user = await new UsersService(new DrizzleUserRepository()).createUser({
      email,
      passwordHash: await hashPassword(password),
      name: "CR-01 Fault Engineer",
      role: "owner",
      publicationId,
    });
    authorId = user.id;

    const roles = new RolesService(new DrizzleRoleRepository());
    const ownerRole = await roles.findByKey("owner");
    expect(ownerRole).not.toBeNull();
    await roles.assignRoleToUser(authorId, ownerRole!.id);
    await pool.query(
      "INSERT INTO publication_memberships (id, publication_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', NOW()) ON CONFLICT DO NOTHING",
      [randomUUID(), publicationId, authorId],
    );

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email, password },
    });
    expect(loginRes.statusCode).toBe(200);
    sessionToken =
      loginRes.cookies.find((c) => c.name === "vibress_session")?.value || "";
    expect(sessionToken).toBeTruthy();
  });

  afterEach(() => {
    crdtPersistence.resetRedisProvider();
  });

  afterAll(async () => {
    crdtPersistence.resetRedisProvider();
    roomManager.clearAllRoomsForTesting();
    if (app) {
      await app.close();
    }
    await closeRedisClient();
    await closeDbPool();
  });

  async function createPostWithTwoRevisions(tag: string): Promise<{
    post: PostPayload;
    revV1: RevisionPayload;
    revV2: RevisionPayload;
  }> {
    const v1Doc = createDefaultStudioDocument(`[${tag}] Baseline V1 Canonical Content`);
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/posts",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: {
        title: `${tag} Title V1`,
        slug: `cr01-${tag.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        content: v1Doc,
        primaryAuthorId: authorId,
        authorIds: [authorId],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdPost = (createRes.json() as { post: PostPayload }).post;

    const revsAfterCreate = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${createdPost.id}/revisions`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
      },
    });
    expect(revsAfterCreate.statusCode).toBe(200);
    const initialRevs = (revsAfterCreate.json() as { revisions: RevisionPayload[] }).revisions;
    expect(initialRevs.length).toBeGreaterThanOrEqual(1);
    const revV1 = initialRevs[initialRevs.length - 1]!;

    const v2Doc = createDefaultStudioDocument(`[${tag}] Newer V2 Content Before Restore`);
    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/admin/v1/posts/${createdPost.id}`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: {
        title: `${tag} Title V2`,
        content: v2Doc,
        expectedVersion: createdPost.version,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updatedPost = (updateRes.json() as { post: PostPayload }).post;

    const revsAfterUpdate = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${createdPost.id}/revisions`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
      },
    });
    const allRevs = (revsAfterUpdate.json() as { revisions: RevisionPayload[] }).revisions;
    const revV2 = allRevs[0]!;

    return { post: updatedPost, revV1, revV2 };
  }

  async function fetchPost(postId: string): Promise<PostPayload> {
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${postId}`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
      },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { post: PostPayload }).post;
  }

  async function connectSyncedClient(
    postId: string,
    customWsBaseUrl = wsBaseUrl,
  ): Promise<{
    ws: WebSocket;
    doc: Y.Doc;
    syncDone: WsControlFrame;
    restoreFrames: WsControlFrame[];
    waitForClose: () => Promise<number>;
  }> {
    const doc = new Y.Doc();
    const restoreFrames: WsControlFrame[] = [];
    let closedCode: number | null = null;
    const closeWaiters: Array<(code: number) => void> = [];
    let resolveSyncDone!: (frame: WsControlFrame) => void;
    const syncDonePromise = new Promise<WsControlFrame>((resolve) => {
      resolveSyncDone = resolve;
    });

    const url = `${customWsBaseUrl}/posts/${postId}/collaboration/ws?token=${encodeURIComponent(sessionToken)}&publicationId=${encodeURIComponent(publicationId)}`;
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(url, {
        headers: {
          Origin: "http://localhost:7777",
          "x-publication-id": publicationId,
        },
      });
      sock.on("close", (code: number) => {
        closedCode = code;
        for (const w of closeWaiters.splice(0)) w(code);
      });
      sock.on("message", (raw: WebSocket.RawData, isBinary: boolean) => {
        const buf = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);
        if (!isBinary) {
          try {
            const parsed = JSON.parse(buf.toString("utf8")) as WsControlFrame;
            if (parsed.type === "restore") {
              restoreFrames.push(parsed);
            }
            if (parsed.type === "sync-done") {
              if (parsed.generationId && parsed.challengeNonce) {
                sock.send(
                  JSON.stringify({
                    type: "ack-sync",
                    epoch: parsed.epoch,
                    generationId: parsed.generationId,
                    challengeNonce: parsed.challengeNonce,
                    clientId: doc.clientID,
                  }),
                  { binary: false },
                );
              }
              resolveSyncDone(parsed);
            }
          } catch {
            // Ignore
          }
        } else {
          Y.applyUpdate(doc, new Uint8Array(buf));
        }
      });
      sock.once("open", () => resolve(sock));
      sock.once("error", reject);
    });

    const syncDone = await syncDonePromise;
    await new Promise((r) => setTimeout(r, 25));
    const waitForClose = () =>
      closedCode !== null
        ? Promise.resolve(closedCode)
        : new Promise<number>((resolve) => {
            closeWaiters.push(resolve);
          });
    return { ws, doc, syncDone, restoreFrames, waitForClose };
  }

  function createFaultyRedisProxy(options: {
    failAllBeforeBegin?: boolean;
    failMultiStepIndex?: number;
    failMultiExecThrow?: boolean;
    failRpush?: boolean;
    failSnapshotSet?: boolean;
  }): RedisClientLike {
    const real = getRedisClient() as unknown as RedisClientLike;
    return {
      async get(key: string) {
        if (options.failAllBeforeBegin) {
          throw new Error("Simulated Redis connection outage before beginRestoration");
        }
        return real.get(key);
      },
      async set(key: string, value: string) {
        if (options.failSnapshotSet && key.includes("crdt:snapshot")) {
          throw new Error("Simulated Redis snapshot write failure");
        }
        if (options.failAllBeforeBegin) {
          throw new Error("Simulated Redis SET outage before beginRestoration");
        }
        return real.set(key, value);
      },
      async del(...keys: string[]) {
        if (options.failAllBeforeBegin) {
          throw new Error("Simulated Redis DEL outage");
        }
        return real.del(...keys);
      },
      async rpush(key: string, ...values: string[]) {
        if (options.failRpush) {
          throw new Error("Simulated Redis RPUSH outage");
        }
        return real.rpush(key, ...values);
      },
      async lrange(key: string, start: number, stop: number) {
        if (options.failAllBeforeBegin) {
          throw new Error("Simulated Redis LRANGE outage");
        }
        return real.lrange(key, start, stop);
      },
      multi(): RedisPipelineLike {
        const realMulti = real.multi();
        const recordedOps: Array<() => Promise<unknown>> = [];
        const proxyPipeline: RedisPipelineLike = {
          del(...keys: string[]) {
            recordedOps.push(() => real.del(...keys));
            realMulti.del(...keys);
            return proxyPipeline;
          },
          set(key: string, value: string) {
            recordedOps.push(() => real.set(key, value));
            realMulti.set(key, value);
            return proxyPipeline;
          },
          async exec() {
            if (options.failMultiExecThrow) {
              throw new Error("Simulated Redis MULTI/EXEC socket disconnect");
            }
            if (options.failMultiStepIndex !== undefined) {
              const results: Array<[Error | null, unknown]> = [];
              for (let idx = 0; idx < recordedOps.length; idx++) {
                if (idx === options.failMultiStepIndex) {
                  results.push([
                    new Error(`Simulated Redis MULTI step #${idx} failure`),
                    null,
                  ]);
                } else if (idx < options.failMultiStepIndex) {
                  const val = await recordedOps[idx]!();
                  results.push([null, val]);
                } else {
                  results.push([
                    new Error(`Aborted subsequent step #${idx} after failure`),
                    null,
                  ]);
                }
              }
              return results;
            }
            return realMulti.exec();
          },
        };
        return proxyPipeline;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Redis failure before restoration begins
  // ---------------------------------------------------------------------------
  it("1. Redis failure before restoration begins returns 503 FAILED and leaves PostgreSQL & prior CRDT state untouched", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S1");
    const preClient = await connectSyncedClient(post.id);
    preClient.doc.getText("content").insert(0, "Pre-restore collaborative edit S1");
    preClient.ws.send(Y.encodeStateAsUpdate(preClient.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 100));
    preClient.ws.close();

    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failAllBeforeBegin: true }),
    );

    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });

    expect(restoreRes.statusCode).toBe(503);
    const errBody = restoreRes.json() as {
      errors: Array<{ restorationStatus: string; code: string }>;
    };
    expect(errBody.errors[0]!.restorationStatus).toBe("FAILED");

    crdtPersistence.resetRedisProvider();

    // Verify PostgreSQL was NEVER mutated when preflight durability check failed
    const dbPostAfter = await fetchPost(post.id);
    expect(dbPostAfter.version).toBe(post.version);
    expect(extractPlainText(dbPostAfter.content)).toContain("Newer V2 Content Before Restore");

    // Verify prior CRDT updates and epoch 1 remain intact
    const epochAfter = await crdtPersistence.getEpoch(publicationId, post.id);
    expect(epochAfter).toBe(1);
    const updatesAfter = await crdtPersistence.getUpdates(publicationId, post.id);
    expect(updatesAfter.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Redis failure during previous snapshot deletion
  // ---------------------------------------------------------------------------
  it("2. Redis failure during previous snapshot deletion (MULTI step #1) returns 503 REQUIRES_RECOVERY, fences room, and recovers cleanly", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S2");
    const seedSnap = new Y.Doc();
    seedSnap.getText("content").insert(0, "Old snapshot S2");
    await crdtPersistence.saveSnapshot(
      publicationId,
      post.id,
      Y.encodeStateAsUpdate(seedSnap),
    );

    const livePeer = await connectSyncedClient(post.id);

    // Step #1 in commitRestoration MULTI is `multi.del(snapshotKey)`
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failMultiStepIndex: 1 }),
    );

    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });

    expect(restoreRes.statusCode).toBe(503);
    const body = restoreRes.json() as {
      errors: Array<{ restorationStatus: string }>;
    };
    expect(body.errors[0]!.restorationStatus).toBe("REQUIRES_RECOVERY");

    // Live peer must be fenced while room requires recovery
    const closePromise = new Promise<number>((resolve) => {
      livePeer.ws.once("close", (code) => resolve(code));
    });
    livePeer.doc.getText("content").insert(0, "Blocked write during recovery ");
    livePeer.ws.send(Y.encodeStateAsUpdate(livePeer.doc), { binary: true });
    expect(await closePromise).toBe(4409);

    // Restore healthy Redis and reconnect -> reconcileWithDatabase heals automatically
    crdtPersistence.resetRedisProvider();
    const recoveredPeer = await connectSyncedClient(post.id);
    expect(recoveredPeer.syncDone.epoch).toBe(2);
    const stateAfter = await crdtPersistence.getRestorationState(publicationId, post.id);
    expect(stateAfter?.status).toBe("COMMITTED");
    expect(recoveredPeer.doc.getText("content").toString()).toBe("");
    recoveredPeer.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Redis failure during update-log cleanup
  // ---------------------------------------------------------------------------
  it("3. Redis failure during update-log cleanup (MULTI step #0) returns 503 REQUIRES_RECOVERY and prevents stale update leakage", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S3");
    const prePeer = await connectSyncedClient(post.id);
    prePeer.doc.getText("content").insert(0, "Stale log entry S3");
    prePeer.ws.send(Y.encodeStateAsUpdate(prePeer.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 100));
    prePeer.ws.close();

    // Step #0 in commitRestoration MULTI is `multi.del(updatesKey)`
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failMultiStepIndex: 0 }),
    );

    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(restoreRes.statusCode).toBe(503);
    expect(
      (restoreRes.json() as { errors: Array<{ restorationStatus: string }> }).errors[0]!
        .restorationStatus,
    ).toBe("REQUIRES_RECOVERY");

    crdtPersistence.resetRedisProvider();
    const freshPeer = await connectSyncedClient(post.id);
    expect(freshPeer.syncDone.epoch).toBe(2);
    // Stale log entry MUST have been purged during reconciliation
    expect(freshPeer.doc.getText("content").toString()).not.toContain("Stale log entry S3");
    freshPeer.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Redis failure while writing the new epoch
  // ---------------------------------------------------------------------------
  it("4. Redis failure while writing new epoch (MULTI step #3) never reports 200 and reconciles to authoritative epoch", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S4");

    // Step #3 in commitRestoration MULTI is `multi.set(epochKey, ...)`
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failMultiStepIndex: 3 }),
    );

    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(restoreRes.statusCode).toBe(503);

    crdtPersistence.resetRedisProvider();
    const dbPost = await fetchPost(post.id);
    const reconciled = await crdtPersistence.reconcileWithDatabase(
      publicationId,
      post.id,
      { version: dbPost.version, content: dbPost.content },
    );
    expect(reconciled.epoch).toBe(2);
    expect(reconciled.restoreState?.status).toBe("COMMITTED");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: PostgreSQL failure before commit
  // ---------------------------------------------------------------------------
  it("5. PostgreSQL failure before commit aborts IN_PROGRESS intent to FAILED and preserves epoch & updates", async () => {
    const { post } = await createPostWithTwoRevisions("S5");
    const peer = await connectSyncedClient(post.id);
    peer.doc.getText("content").insert(0, "Preserved edit S5");
    peer.ws.send(Y.encodeStateAsUpdate(peer.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 100));

    const nonExistentRevId = randomUUID();
    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${nonExistentRevId}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(restoreRes.statusCode).toBe(404);

    const state = await crdtPersistence.getRestorationState(publicationId, post.id);
    expect(state?.status).toBe("FAILED");
    expect(state?.epoch).toBe(1);
    expect(await crdtPersistence.getEpoch(publicationId, post.id)).toBe(1);

    // Connected peer is NOT fenced because restoration aborted cleanly before DB commit
    peer.doc.getText("content").insert(17, " + continued");
    peer.ws.send(Y.encodeStateAsUpdate(peer.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
    peer.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: PostgreSQL failure after dependent work has started
  // ---------------------------------------------------------------------------
  it("6. PostgreSQL failure after dependent work has started releases room barrier and rolls back intent", async () => {
    const { post } = await createPostWithTwoRevisions("S6");
    const peer = await connectSyncedClient(post.id);
    const room = roomManager.getRoom(publicationId, post.id);
    expect(room).toBeDefined();

    await expect(
      roomManager.executeCoordinatedRestore({
        publicationId,
        postId: post.id,
        revisionId: randomUUID(),
        preRestorePostVersion: post.version,
        executeDbRestore: async () => {
          // Verify barrier & IN_PROGRESS intent are active while DB work is mid-flight
          expect(room!.restorationBarrierActive).toBe(true);
          const midState = await crdtPersistence.getRestorationState(
            publicationId,
            post.id,
          );
          expect(midState?.status).toBe("IN_PROGRESS");
          throw new Error("Simulated PostgreSQL serialization failure after dependent work");
        },
      }),
    ).rejects.toThrow("Simulated PostgreSQL serialization failure");

    expect(room!.restorationBarrierActive).toBe(false);
    expect(room!.requiresRecovery).toBe(false);
    const finalState = await crdtPersistence.getRestorationState(publicationId, post.id);
    expect(finalState?.status).toBe("FAILED");
    peer.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Process termination between individual restoration steps
  // ---------------------------------------------------------------------------
  it("7. Process termination between restoration steps recovers deterministically (rollback pre-PG-commit, roll-forward post-PG-commit)", async () => {
    // 7A: Process crashes AFTER beginRestoration writes IN_PROGRESS, BEFORE PostgreSQL commits
    const { post: postA, revV1: revA } = await createPostWithTwoRevisions("S7A");
    const peerA = await connectSyncedClient(postA.id);
    peerA.doc.getText("content").insert(0, "Surviving edit S7A");
    peerA.ws.send(Y.encodeStateAsUpdate(peerA.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 100));
    peerA.ws.close();

    await crdtPersistence.beginRestoration(publicationId, postA.id, {
      revisionId: revA.id,
      preRestorePostVersion: postA.version,
    });
    // Simulate process crash before PostgreSQL commits
    roomManager.clearAllRoomsForTesting();
    crdtPersistence.resetInMemoryStateForTesting();

    const dbPostA = await fetchPost(postA.id);
    const recA = await crdtPersistence.reconcileWithDatabase(publicationId, postA.id, {
      version: dbPostA.version,
      content: dbPostA.content,
    });
    expect(recA.epoch).toBe(1);
    expect(recA.restoreState?.status).toBe("FAILED");
    expect(recA.updates.length).toBeGreaterThan(0);

    // 7B: Process crashes AFTER PostgreSQL commits, BEFORE commitRestoration runs in Redis
    const { post: postB, revV1: revB } = await createPostWithTwoRevisions("S7B");
    const peerB = await connectSyncedClient(postB.id);
    const staleClientIdB = peerB.doc.clientID;
    peerB.doc.getText("content").insert(0, "Pre-crash stale edit S7B");
    peerB.ws.send(Y.encodeStateAsUpdate(peerB.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 100));
    peerB.ws.close();

    const intentB = await crdtPersistence.beginRestoration(publicationId, postB.id, {
      revisionId: revB.id,
      preRestorePostVersion: postB.version,
    });
    // Commit directly to PostgreSQL (simulating crash right after PG COMMIT before Redis Phase 2)
    const pool = getDbPool();
    const v1Content = createDefaultStudioDocument("[S7B] Baseline V1 Canonical Content");
    await pool.query(
      "UPDATE posts SET content = $1::jsonb, version = version + 1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(v1Content), postB.id],
    );

    // Simulate abrupt process termination
    roomManager.clearAllRoomsForTesting();
    crdtPersistence.resetInMemoryStateForTesting();

    // New client connects after restart -> reconcileWithDatabase rolls forward to COMMITTED!
    const postCrashClient = await connectSyncedClient(postB.id);
    expect(postCrashClient.syncDone.epoch).toBe(intentB.targetEpoch);
    expect(postCrashClient.syncDone.generationId).toBe(intentB.generationId);
    expect(postCrashClient.doc.getText("content").toString()).toBe("");
    const metaMap = postCrashClient.doc.getMap("__vibress_meta");
    expect(metaMap.get("epoch")).toBe(intentB.targetEpoch);
    expect(await crdtPersistence.getRevokedClientIds(publicationId, postB.id)).toContain(
      staleClientIdB,
    );
    postCrashClient.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Collaboration server restart after restoration
  // ---------------------------------------------------------------------------
  it("8. Collaboration server restart after restoration preserves durable Yjs snapshot, epoch, and generationId", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S8");

    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(restoreRes.statusCode).toBe(200);
    const committed = restoreRes.json() as {
      epoch: number;
      generationId: string;
      restorationStatus: string;
    };
    expect(committed.restorationStatus).toBe("COMMITTED");
    expect(committed.epoch).toBe(2);

    // Verify raw Redis contains real binary Yjs snapshot
    const redis = getRedisClient();
    const rawSnapshot = await redis.get(
      buildPublicationCacheKey(publicationId, "crdt:snapshot", post.id),
    );
    expect(rawSnapshot).toBeTruthy();

    // Simulate full collaboration server restart with a second Fastify instance & empty memory
    roomManager.clearAllRoomsForTesting();
    crdtPersistence.resetInMemoryStateForTesting();

    const restartedApp = buildApp();
    await restartedApp.ready();
    await restartedApp.listen({ port: 0, host: "127.0.0.1" });
    const restartedAddr = restartedApp.server.address() as AddressInfo;
    const restartedWsUrl = `ws://127.0.0.1:${restartedAddr.port}/api/admin/v1`;

    const clientAfterRestart = await connectSyncedClient(post.id, restartedWsUrl);
    expect(clientAfterRestart.syncDone.epoch).toBe(committed.epoch);
    expect(clientAfterRestart.syncDone.generationId).toBe(committed.generationId);

    const meta = clientAfterRestart.doc.getMap("__vibress_meta");
    expect(meta.get("epoch")).toBe(committed.epoch);
    expect(meta.get("generationId")).toBe(committed.generationId);
    expect(extractPlainText(meta.get("canonicalDocument"))).toContain(
      "[S8] Baseline V1 Canonical Content",
    );

    clientAfterRestart.ws.close();
    await restartedApp.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Client reconnection during restoration
  // ---------------------------------------------------------------------------
  it("9. Client reconnection during active restoration cannot inject stale state and converges on restored generation", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S9");
    const initialClient = await connectSyncedClient(post.id);
    initialClient.doc.getText("content").insert(0, "Pre-restore S9");
    const capturedPreUpdate = Y.encodeStateAsUpdate(initialClient.doc);
    initialClient.ws.send(capturedPreUpdate, { binary: true });
    await new Promise((r) => setTimeout(r, 80));
    initialClient.ws.close();

    let releaseMidRestore!: () => void;
    const midRestoreGate = new Promise<void>((r) => {
      releaseMidRestore = r;
    });
    let notifyEnteredDb!: () => void;
    const enteredDbPromise = new Promise<void>((r) => {
      notifyEnteredDb = r;
    });

    const v1Content = createDefaultStudioDocument("[S9] Baseline V1 Canonical Content");
    const restoreTask = roomManager.executeCoordinatedRestore({
      publicationId,
      postId: post.id,
      revisionId: revV1.id,
      preRestorePostVersion: post.version,
      executeDbRestore: async () => {
        notifyEnteredDb();
        await midRestoreGate;
        const pool = getDbPool();
        const updated = await pool.query<{ version: number }>(
          "UPDATE posts SET content = $1::jsonb, version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING version",
          [JSON.stringify(v1Content), post.id],
        );
        return {
          version: updated.rows[0]!.version,
          content: v1Content,
          title: "S9 Restored",
        };
      },
    });

    await enteredDbPromise;

    // Client reconnects WHILE restoration barrier is active
    const midClient = await connectSyncedClient(post.id);
    if (midClient.ws.readyState === WebSocket.OPEN) {
      midClient.ws.send(capturedPreUpdate, { binary: true });
    }
    expect(await midClient.waitForClose()).toBe(4409);

    // Complete restoration and reconnect cleanly
    releaseMidRestore();
    const restoreOutcome = await restoreTask;
    expect(restoreOutcome.epoch).toBe(2);

    const postRestoreClient = await connectSyncedClient(post.id);
    expect(postRestoreClient.syncDone.epoch).toBe(2);
    expect(postRestoreClient.doc.getText("content").toString()).toBe("");
    postRestoreClient.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Simultaneous editing during restoration
  // ---------------------------------------------------------------------------
  it("10. Simultaneous editing by multiple clients during restoration fences pre-restore writers and preserves restored content", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S10");
    const writerA = await connectSyncedClient(post.id);
    const writerB = await connectSyncedClient(post.id);

    writerA.doc.getText("content").insert(0, "WriterA pre-restore ");
    writerA.ws.send(Y.encodeStateAsUpdate(writerA.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 80));

    // Fire concurrent edits simultaneously with HTTP restore
    const restorePromise = app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });

    writerB.doc.getText("content").insert(0, "WriterB concurrent edit ");
    writerB.ws.send(Y.encodeStateAsUpdate(writerB.doc), { binary: true });

    const restoreRes = await restorePromise;
    expect(restoreRes.statusCode).toBe(200);

    // Post-restore attempt by WriterA on old socket MUST be fenced with 4409
    const closeA = new Promise<number>((r) => writerA.ws.once("close", (code) => r(code)));
    writerA.doc.getText("content").insert(0, "WriterA post-restore stale ");
    writerA.ws.send(Y.encodeStateAsUpdate(writerA.doc), { binary: true });
    expect(await closeA).toBe(4409);
    writerB.ws.close();

    // Verify clean observer sees ONLY restored generation, zero pre-restore text
    const observer = await connectSyncedClient(post.id);
    expect(observer.syncDone.epoch).toBe(2);
    expect(observer.doc.getText("content").toString()).toBe("");
    observer.ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Concurrent restoration requests
  // ---------------------------------------------------------------------------
  it("11. Concurrent restoration requests serialize via per-post lock with strictly monotonic epochs", async () => {
    const { post, revV1, revV2 } = await createPostWithTwoRevisions("S11");

    const [res1, res2, res3] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
        headers: {
          authorization: `Bearer ${sessionToken}`,
          cookie: `vibress_session=${sessionToken}`,
          "x-publication-id": publicationId,
          origin: "http://localhost:7777",
        },
      }),
      app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${post.id}/revisions/${revV2.id}/restore`,
        headers: {
          authorization: `Bearer ${sessionToken}`,
          cookie: `vibress_session=${sessionToken}`,
          "x-publication-id": publicationId,
          origin: "http://localhost:7777",
        },
      }),
      app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
        headers: {
          authorization: `Bearer ${sessionToken}`,
          cookie: `vibress_session=${sessionToken}`,
          "x-publication-id": publicationId,
          origin: "http://localhost:7777",
        },
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res3.statusCode).toBe(200);

    const epochs = [
      (res1.json() as { epoch: number }).epoch,
      (res2.json() as { epoch: number }).epoch,
      (res3.json() as { epoch: number }).epoch,
    ].sort((a, b) => a - b);

    expect(epochs).toEqual([2, 3, 4]);
    expect(await crdtPersistence.getEpoch(publicationId, post.id)).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 12: Restoration retries after partial failure
  // ---------------------------------------------------------------------------
  it("12. Restoration retry after partial Redis commit failure succeeds cleanly and clears REQUIRES_RECOVERY", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S12");

    // Attempt 1: fail Redis MULTI/EXEC after PG commits
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failMultiExecThrow: true }),
    );
    const attempt1 = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(attempt1.statusCode).toBe(503);
    expect(crdtPersistence.hasPendingRecovery(publicationId, post.id)).toBe(true);

    // Attempt 2: restore Redis connectivity and retry REST endpoint
    crdtPersistence.resetRedisProvider();
    const attempt2 = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(attempt2.statusCode).toBe(200);
    const body2 = attempt2.json() as {
      epoch: number;
      restorationStatus: string;
    };
    expect(body2.restorationStatus).toBe("COMMITTED");
    expect(body2.epoch).toBe(3);
    expect(crdtPersistence.hasPendingRecovery(publicationId, post.id)).toBe(false);

    const state = await crdtPersistence.getRestorationState(publicationId, post.id);
    expect(state?.status).toBe("COMMITTED");
    expect(state?.epoch).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 13: Recovery after a previously interrupted restoration (Idempotency)
  // ---------------------------------------------------------------------------
  it("13. Recovery after a previously interrupted restoration is strictly idempotent across repeated reconciliations", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S13");

    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failMultiExecThrow: true }),
    );
    const failedRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(failedRes.statusCode).toBe(503);

    crdtPersistence.resetRedisProvider();
    const dbPost = await fetchPost(post.id);

    const rec1 = await crdtPersistence.reconcileWithDatabase(publicationId, post.id, {
      version: dbPost.version,
      content: dbPost.content,
    });
    const rec2 = await crdtPersistence.reconcileWithDatabase(publicationId, post.id, {
      version: dbPost.version,
      content: dbPost.content,
    });
    const rec3 = await crdtPersistence.reconcileWithDatabase(publicationId, post.id, {
      version: dbPost.version,
      content: dbPost.content,
    });

    expect(rec1.restoreState?.status).toBe("COMMITTED");
    expect(rec2.epoch).toBe(rec1.epoch);
    expect(rec3.epoch).toBe(rec1.epoch);
    expect(rec2.generationId).toBe(rec1.generationId);
    expect(rec3.generationId).toBe(rec1.generationId);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 14: Rehydration from persistent storage after complete process restart
  // ---------------------------------------------------------------------------
  it("14. Rehydrates both restored seed snapshot and post-restore collaborative updates after complete process restart", async () => {
    const { post, revV1 } = await createPostWithTwoRevisions("S14");

    // Pre-restore edit that MUST NOT reappear
    const oldPeer = await connectSyncedClient(post.id);
    oldPeer.doc.getText("content").insert(0, "OBSOLETE_PRE_RESTORE_S14");
    oldPeer.ws.send(Y.encodeStateAsUpdate(oldPeer.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 80));
    oldPeer.ws.close();

    // Restore to V1
    const restoreRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/revisions/${revV1.id}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(restoreRes.statusCode).toBe(200);
    const { epoch, generationId } = restoreRes.json() as {
      epoch: number;
      generationId: string;
    };

    // Post-restore writer completes valid handshake on epoch 2 and writes new collaborative content
    const newWriter = await connectSyncedClient(post.id);
    expect(newWriter.syncDone.epoch).toBe(epoch);
    newWriter.doc.getText("content").insert(0, "DURABLE_POST_RESTORE_COLLAB_S14");
    newWriter.ws.send(Y.encodeStateAsUpdate(newWriter.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 120));
    newWriter.ws.close();

    // Simulate complete process termination & restart
    roomManager.clearAllRoomsForTesting();
    crdtPersistence.resetInMemoryStateForTesting();

    const freshApp = buildApp();
    await freshApp.ready();
    await freshApp.listen({ port: 0, host: "127.0.0.1" });
    const freshAddr = freshApp.server.address() as AddressInfo;
    const freshWsUrl = `ws://127.0.0.1:${freshAddr.port}/api/admin/v1`;

    const rehydratedClient = await connectSyncedClient(post.id, freshWsUrl);
    expect(rehydratedClient.syncDone.epoch).toBe(epoch);
    expect(rehydratedClient.syncDone.generationId).toBe(generationId);
    expect(rehydratedClient.doc.getText("content").toString()).toBe(
      "DURABLE_POST_RESTORE_COLLAB_S14",
    );
    expect(rehydratedClient.doc.getText("content").toString()).not.toContain(
      "OBSOLETE_PRE_RESTORE_S14",
    );
    expect(rehydratedClient.doc.getMap("__vibress_meta").get("epoch")).toBe(epoch);

    rehydratedClient.ws.close();
    await freshApp.close();
  });

  // CRDT-15: Redis failure must never be acknowledged to HTTP writers.
  it("15. HTTP returns 503 and preserves CRDT state when Redis RPUSH fails", async () => {
    const { post } = await createPostWithTwoRevisions("S15");
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "UNACKED_HTTP_WRITE_S15");
    const binary = Y.encodeStateAsUpdate(doc);
    const before = await crdtPersistence.getUpdates(publicationId, post.id);
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failRpush: true }),
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: Buffer.from(binary).toString("base64") },
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { errors: Array<{ code: string }> }).errors[0]?.code)
      .toBe("CRDT_REDIS_UNAVAILABLE");
    crdtPersistence.resetRedisProvider();
    crdtPersistence.resetInMemoryStateForTesting();
    const after = await crdtPersistence.getUpdates(publicationId, post.id);
    expect(after).toEqual(before);
    doc.destroy();
  });

  it("16. WebSocket rejects and does not broadcast updates when Redis RPUSH fails", async () => {
    const { post } = await createPostWithTwoRevisions("S16");
    const writer = await connectSyncedClient(post.id);
    const reader = await connectSyncedClient(post.id);
    const baseline = reader.doc.getText("content").toString();
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failRpush: true }),
    );
    writer.doc.getText("content").insert(0, "UNACKED_WS_WRITE_S16");
    writer.ws.send(Y.encodeStateAsUpdate(writer.doc), { binary: true });
    expect(await writer.waitForClose()).toBe(1013);
    expect(reader.doc.getText("content").toString()).toBe(baseline);
    crdtPersistence.resetRedisProvider();
    const updates = await crdtPersistence.getUpdates(publicationId, post.id);
    expect(updates).toHaveLength(0);
    reader.ws.close();
    writer.doc.destroy();
    reader.doc.destroy();
  });

  it("17. Snapshot failures never leave a false durable checkpoint", async () => {
    const { post } = await createPostWithTwoRevisions("S17");
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "UNACKED_SNAPSHOT_S17");
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failSnapshotSet: true }),
    );
    await expect(
      crdtPersistence.saveSnapshot(publicationId, post.id, Y.encodeStateAsUpdate(doc)),
    ).rejects.toMatchObject({ code: "CRDT_REDIS_UNAVAILABLE" });
    crdtPersistence.resetRedisProvider();
    crdtPersistence.resetInMemoryStateForTesting();
    expect(await crdtPersistence.getSnapshot(publicationId, post.id)).toBeNull();
    doc.destroy();
  });

  it("18. Compaction MULTI partial failure is surfaced instead of reporting success", async () => {
    const { post } = await createPostWithTwoRevisions("S18");
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "PENDING_COMPACTION_S18");
    crdtPersistence.setRedisProviderForTesting(() =>
      createFaultyRedisProxy({ failMultiStepIndex: 0 }),
    );
    await expect(
      crdtPersistence.compact(publicationId, post.id, Y.encodeStateAsUpdate(doc)),
    ).rejects.toMatchObject({ code: "CRDT_COMPACTION_FAILED" });
    crdtPersistence.resetRedisProvider();
    doc.destroy();
  });
});
