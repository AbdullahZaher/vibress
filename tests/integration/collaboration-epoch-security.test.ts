import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/main";
import { getDbPool, closeDbPool } from "@vibress/database";
import { closeRedisClient } from "@vibress/cache";
import { hashPassword } from "@vibress/security";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { DrizzleRoleRepository, RolesService } from "@vibress/roles";
import { createDefaultStudioDocument, migrateDocument } from "@vibress/studio-core";
import { roomManager } from "../../apps/api/src/collaboration/room-manager";
import { crdtPersistence } from "../../apps/api/src/collaboration/crdt-persistence";

interface PostRecord {
  id: string;
  version: number;
  title: string;
  content: unknown;
}

interface RevisionRecord {
  id: string;
}

interface ControlFrame {
  type: string;
  epoch?: number;
  generationId?: string;
  challengeNonce?: string;
  content?: unknown;
  restoredContent?: unknown;
}

describe("CR-02 — Collaboration Epoch Bypass & Stale Yjs Replay Security Regression Suite", () => {
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

    const email = `cr02-sec-${randomUUID()}@vibress.local`;
    const password = `Cr02Pass-${randomUUID()}!`;
    const user = await new UsersService(new DrizzleUserRepository()).createUser({
      email,
      passwordHash: await hashPassword(password),
      name: "CR-02 Security Auditor",
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

  afterAll(async () => {
    roomManager.clearAllRoomsForTesting();
    if (app) {
      await app.close();
    }
    await closeRedisClient();
    await closeDbPool();
  });

  async function setupRestorablePost(label: string): Promise<{
    post: PostRecord;
    revV1: RevisionRecord;
  }> {
    const docV1 = createDefaultStudioDocument(`[${label}] Clean Restored V1 Truth`);
    const createdRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/posts",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: {
        title: `${label} V1`,
        slug: `cr02-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        content: docV1,
        primaryAuthorId: authorId,
        authorIds: [authorId],
      },
    });
    expect(createdRes.statusCode).toBe(201);
    const createdPost = (createdRes.json() as { post: PostRecord }).post;

    const revsRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${createdPost.id}/revisions`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
      },
    });
    const revs = (revsRes.json() as { revisions: RevisionRecord[] }).revisions;
    const revV1 = revs[revs.length - 1]!;

    const docV2 = createDefaultStudioDocument(`[${label}] Pre-Restore V2 Draft`);
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
        title: `${label} V2`,
        content: docV2,
        expectedVersion: createdPost.version,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    return {
      post: (updateRes.json() as { post: PostRecord }).post,
      revV1,
    };
  }

  async function restoreToRevision(
    postId: string,
    revisionId: string,
  ): Promise<{ epoch: number; generationId: string; post: PostRecord }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${postId}/revisions/${revisionId}/restore`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as {
      epoch: number;
      generationId: string;
      post: PostRecord;
    };
  }

  async function openRawSocket(
    postId: string,
    options: {
      epoch?: number | string;
      generationId?: string;
      autoAckSync?: boolean;
      customWsBaseUrl?: string;
    } = {},
  ): Promise<{
    ws: WebSocket;
    doc: Y.Doc;
    syncDone: ControlFrame;
    controlFrames: ControlFrame[];
    waitForClose: () => Promise<number>;
  }> {
    const doc = new Y.Doc();
    const controlFrames: ControlFrame[] = [];
    let closedCode: number | null = null;
    const closeWaiters: Array<(code: number) => void> = [];
    let resolveSyncDone!: (frame: ControlFrame) => void;
    const syncDonePromise = new Promise<ControlFrame>((resolve) => {
      resolveSyncDone = resolve;
    });

    const params = new URLSearchParams({
      token: sessionToken,
      publicationId,
    });
    if (options.epoch !== undefined) {
      params.set("epoch", String(options.epoch));
    }
    if (options.generationId !== undefined) {
      params.set("generationId", options.generationId);
    }

    const base = options.customWsBaseUrl || wsBaseUrl;
    const url = `${base}/posts/${postId}/collaboration/ws?${params.toString()}`;
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
            const parsed = JSON.parse(buf.toString("utf8")) as ControlFrame;
            controlFrames.push(parsed);
            if (parsed.type === "sync-done") {
              if (
                options.autoAckSync !== false &&
                parsed.generationId &&
                parsed.challengeNonce
              ) {
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
    return { ws, doc, syncDone, controlFrames, waitForClose };
  }

  async function assertAuthoritativeDocumentUnpolluted(
    postId: string,
    forbiddenStrings: string[],
    expectedEpoch: number,
  ): Promise<void> {
    const observer = await openRawSocket(postId, { autoAckSync: true });
    expect(observer.syncDone.epoch).toBe(expectedEpoch);
    const yText = observer.doc.getText("content").toString();
    for (const forbidden of forbiddenStrings) {
      expect(yText).not.toContain(forbidden);
    }
    const meta = observer.doc.getMap("__vibress_meta");
    expect(meta.get("epoch")).toBe(expectedEpoch);
    observer.ws.close();

    // Also verify PostgreSQL canonical content remains untouched by stale CRDT frames
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
    const pgJson = JSON.stringify(
      migrateDocument((res.json() as { post: PostRecord }).post.content),
    );
    for (const forbidden of forbiddenStrings) {
      expect(pgJson).not.toContain(forbidden);
    }
  }

  // ---------------------------------------------------------------------------
  // SCENARIOS 1 & 2: Stale client sends `ack-epoch` / `ack-restore` with latest
  // epoch and subsequently submits old Yjs updates -> MUST BE REJECTED (4409)
  // ---------------------------------------------------------------------------
  it("1 & 2. Stale client sending ack-epoch / ack-restore with latest epoch cannot self-promote or submit old Yjs updates", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec1_2");
    const attacker = await openRawSocket(post.id);

    attacker.doc.getText("content").insert(0, "ATTACKER_STALE_PAYLOAD_1");
    attacker.ws.send(Y.encodeStateAsUpdate(attacker.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 80));

    // Trigger revision restoration -> room moves to epoch 2 and permanently fences pre-existing sockets
    const restored = await restoreToRevision(post.id, revV1.id);
    expect(restored.epoch).toBe(2);

    // Attacker sends legacy client-controlled `ack-epoch` AND `ack-restore` claiming epoch 2
    attacker.ws.send(
      JSON.stringify({ type: "ack-epoch", epoch: restored.epoch }),
      { binary: false },
    );
    attacker.ws.send(
      JSON.stringify({ type: "ack-restore", epoch: restored.epoch }),
      { binary: false },
    );
    await new Promise((r) => setTimeout(r, 50));

    // Attacker now attempts to submit Yjs updates from its outdated Y.Doc
    const closePromise = new Promise<number>((resolve) => {
      attacker.ws.once("close", (code) => resolve(code));
    });
    attacker.doc.getText("content").insert(0, "CORRUPTION_AFTER_FAKE_ACK ");
    attacker.ws.send(Y.encodeStateAsUpdate(attacker.doc), { binary: true });

    expect(await closePromise).toBe(4409);

    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["ATTACKER_STALE_PAYLOAD_1", "CORRUPTION_AFTER_FAKE_ACK"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Client reconnects without an epoch and skips handshake
  // ---------------------------------------------------------------------------
  it("3. Client reconnecting without an epoch at epoch >= 2 cannot publish updates without completing ack-sync handshake", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec3");
    const restored = await restoreToRevision(post.id, revV1.id);
    expect(restored.epoch).toBe(2);

    // Connect WITHOUT `?epoch` query parameter and do NOT send `ack-sync`
    const unverifiedClient = await openRawSocket(post.id, {
      autoAckSync: false,
    });
    expect(unverifiedClient.syncDone.epoch).toBe(2);

    const closePromise = new Promise<number>((resolve) => {
      unverifiedClient.ws.once("close", (code) => resolve(code));
    });
    unverifiedClient.doc.getText("content").insert(0, "UNHANDSHAKEN_WRITE_SEC3");
    unverifiedClient.ws.send(Y.encodeStateAsUpdate(unverifiedClient.doc), {
      binary: true,
    });

    expect(await closePromise).toBe(4409);
    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["UNHANDSHAKEN_WRITE_SEC3"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Client reconnects using a forged epoch or forged generationId
  // ---------------------------------------------------------------------------
  it("4. Client reconnecting with forged epoch (?epoch=999) or forged generationId is immediately fenced and rejected (4409)", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec4");
    const restored = await restoreToRevision(post.id, revV1.id);

    // 4a: Forged future epoch (?epoch=999)
    const forgedEpochClient = await openRawSocket(post.id, {
      epoch: 999,
      autoAckSync: false,
    });
    const closeEpoch = new Promise<number>((r) =>
      forgedEpochClient.ws.once("close", (code) => r(code)),
    );
    forgedEpochClient.doc.getText("content").insert(0, "FORGED_EPOCH_999");
    forgedEpochClient.ws.send(Y.encodeStateAsUpdate(forgedEpochClient.doc), {
      binary: true,
    });
    expect(await closeEpoch).toBe(4409);

    // 4b: Matching epoch=2, but forged generationId
    const forgedGenClient = await openRawSocket(post.id, {
      epoch: restored.epoch,
      generationId: "gen_2_forged_attacker_uuid",
      autoAckSync: false,
    });
    const closeGen = new Promise<number>((r) =>
      forgedGenClient.ws.once("close", (code) => r(code)),
    );
    forgedGenClient.doc.getText("content").insert(0, "FORGED_GEN_ID");
    forgedGenClient.ws.send(Y.encodeStateAsUpdate(forgedGenClient.doc), {
      binary: true,
    });
    expect(await closeGen).toBe(4409);

    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["FORGED_EPOCH_999", "FORGED_GEN_ID"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Client replays previously captured pre-restore updates AFTER
  // completing a valid handshake on a brand-new connection!
  // ---------------------------------------------------------------------------
  it("5. Replaying previously captured pre-restore binary Yjs updates on a validly handshaken post-restore socket is rejected (4409)", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec5");

    // Pre-restore client creates and captures binary updates
    const preClient = await openRawSocket(post.id);
    preClient.doc.getText("content").insert(0, "CAPTURED_PRE_RESTORE_REPLAY_SEC5");
    const capturedBinaryUpdate = Y.encodeStateAsUpdate(preClient.doc);
    preClient.ws.send(capturedBinaryUpdate, { binary: true });
    await new Promise((r) => setTimeout(r, 80));
    preClient.ws.close();

    // Restore revision -> revokes preClient.doc.clientID durably
    const restored = await restoreToRevision(post.id, revV1.id);

    // Fresh client connects legitimately and completes valid `ack-sync` handshake with a NEW clientID
    const replayClient = await openRawSocket(post.id, { autoAckSync: true });
    await new Promise((r) => setTimeout(r, 50));

    // Now replayClient replays the previously captured pre-restore binary update!
    const closePromise = new Promise<number>((r) =>
      replayClient.ws.once("close", (code) => r(code)),
    );
    replayClient.ws.send(capturedBinaryUpdate, { binary: true });

    expect(await closePromise).toBe(4409);
    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["CAPTURED_PRE_RESTORE_REPLAY_SEC5"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Two clients edit while a revision restoration occurs
  // ---------------------------------------------------------------------------
  it("6. Two clients actively editing while revision restoration occurs cannot corrupt restored document state", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec6");
    const editorA = await openRawSocket(post.id);
    const editorB = await openRawSocket(post.id);

    editorA.doc.getText("content").insert(0, "EDITOR_A_OLD ");
    editorB.doc.getText("content").insert(0, "EDITOR_B_OLD ");
    editorA.ws.send(Y.encodeStateAsUpdate(editorA.doc), { binary: true });
    editorB.ws.send(Y.encodeStateAsUpdate(editorB.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 80));

    const restored = await restoreToRevision(post.id, revV1.id);

    const closeA = new Promise<number>((r) => editorA.ws.once("close", (c) => r(c)));
    const closeB = new Promise<number>((r) => editorB.ws.once("close", (c) => r(c)));

    editorA.doc.getText("content").insert(0, "EDITOR_A_LATE ");
    editorB.doc.getText("content").insert(0, "EDITOR_B_LATE ");
    editorA.ws.send(Y.encodeStateAsUpdate(editorA.doc), { binary: true });
    editorB.ws.send(Y.encodeStateAsUpdate(editorB.doc), { binary: true });

    expect(await closeA).toBe(4409);
    expect(await closeB).toBe(4409);

    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["EDITOR_A_OLD", "EDITOR_B_OLD", "EDITOR_A_LATE", "EDITOR_B_LATE"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Stale browser tab resumes after restoration
  // ---------------------------------------------------------------------------
  it("7. Stale browser tab resuming from sleep after restoration with old epoch/generationId is fenced and cannot overwrite content", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec7");
    const sleepingTab = await openRawSocket(post.id);
    const oldEpoch = sleepingTab.syncDone.epoch!;
    const oldGen = sleepingTab.syncDone.generationId!;

    sleepingTab.doc.getText("content").insert(0, "SLEEPING_TAB_STALE_TEXT");
    const offlineBuffer = Y.encodeStateAsUpdate(sleepingTab.doc);
    sleepingTab.ws.close();

    // Restoration happens while tab was backgrounded/disconnected
    const restored = await restoreToRevision(post.id, revV1.id);

    // Tab wakes up and reconnects carrying its boundEpoch & boundGenerationId
    const resumedTab = await openRawSocket(post.id, {
      epoch: oldEpoch,
      generationId: oldGen,
      autoAckSync: false,
    });

    const closePromise = new Promise<number>((r) =>
      resumedTab.ws.once("close", (c) => r(c)),
    );
    resumedTab.ws.send(offlineBuffer, { binary: true });
    expect(await closePromise).toBe(4409);

    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["SLEEPING_TAB_STALE_TEXT"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Network partition occurs immediately before restoration
  // ---------------------------------------------------------------------------
  it("8. Client partitioned immediately before restoration that buffered offline CRDT mutations cannot merge them after partition heals", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec8");

    // Client connects and syncs before partition
    const partitioned = await openRawSocket(post.id);
    partitioned.doc.getText("content").insert(0, "PRE_PARTITION_SYNCED ");
    partitioned.ws.send(Y.encodeStateAsUpdate(partitioned.doc), { binary: true });
    await new Promise((r) => setTimeout(r, 80));

    // Network drops abruptly before restoration
    partitioned.ws.terminate();
    await new Promise((r) => setTimeout(r, 50));

    // User continues typing into partitioned Y.Doc while offline
    partitioned.doc.getText("content").insert(21, "OFFLINE_PARTITION_DELTA");
    const deltaDuringPartition = Y.encodeStateAsUpdate(partitioned.doc);

    // Meanwhile, admin restores revision to V1
    const restored = await restoreToRevision(post.id, revV1.id);

    // Partition heals; even if client connects without query params and tries to ack-sync with its old doc.clientID,
    // `ack-sync` rejects the revoked clientID with 4409!
    const healedConn = await openRawSocket(post.id, { autoAckSync: false });
    const closePromise = new Promise<number>((r) =>
      healedConn.ws.once("close", (c) => r(c)),
    );
    healedConn.ws.send(
      JSON.stringify({
        type: "ack-sync",
        epoch: healedConn.syncDone.epoch,
        generationId: healedConn.syncDone.generationId,
        challengeNonce: healedConn.syncDone.challengeNonce,
        clientId: partitioned.doc.clientID,
      }),
      { binary: false },
    );
    expect(await closePromise).toBe(4409);

    // Even if client omits clientId in ack-sync and sends deltaDuringPartition, binary payload check rejects it!
    const sneakyConn = await openRawSocket(post.id, { autoAckSync: false });
    sneakyConn.ws.send(
      JSON.stringify({
        type: "ack-sync",
        epoch: sneakyConn.syncDone.epoch,
        generationId: sneakyConn.syncDone.generationId,
        challengeNonce: sneakyConn.syncDone.challengeNonce,
      }),
      { binary: false },
    );
    await new Promise((r) => setTimeout(r, 40));
    const sneakyClose = new Promise<number>((r) =>
      sneakyConn.ws.once("close", (c) => r(c)),
    );
    sneakyConn.ws.send(deltaDuringPartition, { binary: true });
    expect(await sneakyClose).toBe(4409);

    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["PRE_PARTITION_SYNCED", "OFFLINE_PARTITION_DELTA"],
      restored.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Update arrives while the restore synchronization barrier is active
  // ---------------------------------------------------------------------------
  it("9. Binary update arriving while restore synchronization barrier is active is deterministically rejected (4409)", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec9");
    const activePeer = await openRawSocket(post.id);

    let releaseRestore!: () => void;
    const gate = new Promise<void>((r) => {
      releaseRestore = r;
    });
    let barrierReady!: () => void;
    const barrierReadyPromise = new Promise<void>((r) => {
      barrierReady = r;
    });

    const v1Content = createDefaultStudioDocument("[Sec9] Clean Restored V1 Truth");
    const restorePromise = roomManager.executeCoordinatedRestore({
      publicationId,
      postId: post.id,
      revisionId: revV1.id,
      preRestorePostVersion: post.version,
      executeDbRestore: async () => {
        barrierReady();
        await gate;
        const pool = getDbPool();
        const updated = await pool.query<{ version: number }>(
          "UPDATE posts SET content = $1::jsonb, version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING version",
          [JSON.stringify(v1Content), post.id],
        );
        return {
          version: updated.rows[0]!.version,
          content: v1Content,
          title: "Sec9 Restored",
        };
      },
    });

    await barrierReadyPromise;

    activePeer.doc.getText("content").insert(0, "BARRIER_RACE_WRITE_SEC9");
    if (activePeer.ws.readyState === WebSocket.OPEN) {
      activePeer.ws.send(Y.encodeStateAsUpdate(activePeer.doc), { binary: true });
    }
    expect(await activePeer.waitForClose()).toBe(4409);

    releaseRestore();
    const outcome = await restorePromise;
    await assertAuthoritativeDocumentUnpolluted(
      post.id,
      ["BARRIER_RACE_WRITE_SEC9"],
      outcome.epoch,
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Malicious or malfunctioning client attempts to bypass handshake
  // ---------------------------------------------------------------------------
  it("10. Malicious client sending forged challengeNonce or wrong generationId in ack-sync is immediately terminated (4409)", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec10");
    const restored = await restoreToRevision(post.id, revV1.id);

    // 10a: Forged challengeNonce
    const rogueA = await openRawSocket(post.id, { autoAckSync: false });
    const closeRogueA = new Promise<number>((r) =>
      rogueA.ws.once("close", (c) => r(c)),
    );
    rogueA.ws.send(
      JSON.stringify({
        type: "ack-sync",
        epoch: restored.epoch,
        generationId: restored.generationId,
        challengeNonce: "forged-nonce-0000",
        clientId: rogueA.doc.clientID,
      }),
      { binary: false },
    );
    expect(await closeRogueA).toBe(4409);

    // 10b: Wrong generationId with real nonce
    const rogueB = await openRawSocket(post.id, { autoAckSync: false });
    const closeRogueB = new Promise<number>((r) =>
      rogueB.ws.once("close", (c) => r(c)),
    );
    rogueB.ws.send(
      JSON.stringify({
        type: "ack-sync",
        epoch: restored.epoch,
        generationId: "gen_2_wrong",
        challengeNonce: rogueB.syncDone.challengeNonce,
        clientId: rogueB.doc.clientID,
      }),
      { binary: false },
    );
    expect(await closeRogueB).toBe(4409);

    await assertAuthoritativeDocumentUnpolluted(post.id, [], restored.epoch);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Collaboration server restarts while stale clients remain connected
  // ---------------------------------------------------------------------------
  it("11. Collaboration server restart preserves durable revokedClientIds & generationId so reconnecting stale clients remain blocked", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec11");
    const stalePeer = await openRawSocket(post.id);
    stalePeer.doc.getText("content").insert(0, "PRE_RESTART_STALE_SEC11");
    const staleBinary = Y.encodeStateAsUpdate(stalePeer.doc);
    stalePeer.ws.send(staleBinary, { binary: true });
    await new Promise((r) => setTimeout(r, 80));

    const restored = await restoreToRevision(post.id, revV1.id);

    // Restart collaboration server while stalePeer still holds its old Y.Doc in browser memory
    roomManager.clearAllRoomsForTesting();
    crdtPersistence.resetInMemoryStateForTesting();

    const restartedServer = buildApp();
    await restartedServer.ready();
    await restartedServer.listen({ port: 0, host: "127.0.0.1" });
    const newAddr = restartedServer.server.address() as AddressInfo;
    const newWsBaseUrl = `ws://127.0.0.1:${newAddr.port}/api/admin/v1`;

    // Stale client reconnects to the restarted server and tries to push its stale Y.Doc update
    const reconnectedStale = await openRawSocket(post.id, {
      customWsBaseUrl: newWsBaseUrl,
      autoAckSync: true,
    });
    await new Promise((r) => setTimeout(r, 50));

    const closeOnReplay = new Promise<number>((r) =>
      reconnectedStale.ws.once("close", (c) => r(c)),
    );
    reconnectedStale.ws.send(staleBinary, { binary: true });
    expect(await closeOnReplay).toBe(4409);

    // Verify clean state on restarted server
    const cleanObserver = await openRawSocket(post.id, {
      customWsBaseUrl: newWsBaseUrl,
      autoAckSync: true,
    });
    expect(cleanObserver.syncDone.epoch).toBe(restored.epoch);
    expect(cleanObserver.syncDone.generationId).toBe(restored.generationId);
    expect(cleanObserver.doc.getText("content").toString()).not.toContain(
      "PRE_RESTART_STALE_SEC11",
    );
    cleanObserver.ws.close();
    await restartedServer.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 12: HTTP CRDT endpoint (`POST /posts/:postId/collaboration/crdt`)
  // cannot be abused to bypass WebSocket epoch/generation/revocation checks
  // ---------------------------------------------------------------------------
  it("12. HTTP CRDT endpoint enforces epoch, generationId, and revokedClientIds after restoration (409 EPOCH_CONFLICT)", async () => {
    const { post, revV1 } = await setupRestorablePost("Sec12Http");
    const preDoc = new Y.Doc();
    preDoc.getText("content").insert(0, "HTTP_PRE_RESTORE_SEC12");
    const preB64 = Buffer.from(Y.encodeStateAsUpdate(preDoc)).toString("base64");

    const preHttpRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: preB64 },
    });
    expect(preHttpRes.statusCode).toBe(200);

    const restored = await restoreToRevision(post.id, revV1.id);

    // 12a: Missing epoch/generationId at epoch >= 2 -> 409
    const freshDoc = new Y.Doc();
    freshDoc.getText("content").insert(0, "HTTP_MISSING_EPOCH");
    const freshB64 = Buffer.from(Y.encodeStateAsUpdate(freshDoc)).toString("base64");

    const missingMetaRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: freshB64 },
    });
    expect(missingMetaRes.statusCode).toBe(409);

    // 12b: Correct epoch & generationId, but replaying pre-restore revoked client update -> 409
    const replayHttpRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: {
        update: preB64,
        epoch: restored.epoch,
        generationId: restored.generationId,
      },
    });
    expect(replayHttpRes.statusCode).toBe(409);

    // 12c: Valid new Y.Doc update with authoritative epoch + generationId -> 200
    const validHttpRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: {
        update: freshB64,
        epoch: restored.epoch,
        generationId: restored.generationId,
      },
    });
    expect(validHttpRes.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 13 (F-01): Cross-tenant isolation on collaboration endpoints
  // ---------------------------------------------------------------------------
  it("13. [F-01] Cross-tenant access to collaboration CRDT, room, comments returns 404/403", async () => {
    const pool = getDbPool();
    const pubRow = await pool.query<{ id: string; workspace_id: string }>(
      "SELECT id, workspace_id FROM publications LIMIT 1",
    );
    const workspaceId = pubRow.rows[0]!.workspace_id;
    const otherPubId = `pub-tenant-${randomUUID().slice(0, 8)}`;
    await pool.query(
      "INSERT INTO publications (id, workspace_id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
      [otherPubId, workspaceId, "Other Tenant", `other-${randomUUID().slice(0, 8)}`],
    );

    const { post } = await setupRestorablePost("TenantIso");

    // 13a: Attempting to access post via mismatched x-publication-id returns 403/404
    const crossTenantHttpRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": otherPubId,
        origin: "http://localhost:7777",
      },
      payload: { update: "AQ==" },
    });
    expect([403, 404]).toContain(crossTenantHttpRes.statusCode);

    // 13b: GET /collaboration/room returns 403/404 for wrong publication
    const roomRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${post.id}/collaboration/room`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": otherPubId,
        origin: "http://localhost:7777",
      },
    });
    expect([403, 404]).toContain(roomRes.statusCode);

    // Clean up created publication
    await pool.query("DELETE FROM publications WHERE id = $1", [otherPubId]);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 14 (F-02): Fine-grained resource authorization for post editing
  // ---------------------------------------------------------------------------
  it("14. [F-02] Contributor cannot edit another author's post via HTTP CRDT (403) or WS (canEdit=false)", async () => {
    const pool = getDbPool();
    const contribEmail = `contrib-${randomUUID()}@vibress.local`;
    const contribPass = `ContribPass-${randomUUID()}!`;
    const contribUser = await new UsersService(new DrizzleUserRepository()).createUser({
      email: contribEmail,
      passwordHash: await hashPassword(contribPass),
      name: "Contributor User",
      role: "contributor",
      publicationId,
    });

    const roles = new RolesService(new DrizzleRoleRepository());
    const contribRole = await roles.findByKey("contributor");
    if (contribRole) {
      await roles.assignRoleToUser(contribUser.id, contribRole.id);
    }
    await pool.query(
      "INSERT INTO publication_memberships (id, publication_id, user_id, role, created_at) VALUES ($1, $2, $3, 'contributor', NOW()) ON CONFLICT DO NOTHING",
      [randomUUID(), publicationId, contribUser.id],
    );

    const contribLoginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: contribEmail, password: contribPass },
    });
    expect(contribLoginRes.statusCode).toBe(200);
    const contribToken =
      contribLoginRes.cookies.find((c) => c.name === "vibress_session")?.value || "";

    const { post } = await setupRestorablePost("ContribAuth");

    // 14a: Contributor tries to mutate post via HTTP CRDT -> 403 Forbidden
    const testDoc = new Y.Doc();
    testDoc.getText("content").insert(0, "ILLEGAL_MUTATION");
    const testB64 = Buffer.from(Y.encodeStateAsUpdate(testDoc)).toString("base64");

    const contribHttpRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${contribToken}`,
        cookie: `vibress_session=${contribToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: testB64 },
    });
    expect(contribHttpRes.statusCode).toBe(403);

    // 14b: Contributor opens WS connection -> receives canEdit: false in sync-init frame
    const params = new URLSearchParams({
      token: contribToken,
      publicationId,
    });
    const wsUrl = `${wsBaseUrl}/posts/${post.id}/collaboration/ws?${params.toString()}`;
    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: "http://localhost:7777",
        "x-publication-id": publicationId,
      },
    });

    const initFrame = await new Promise<ControlFrame>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for WS sync-init")), 5000);
      ws.on("message", (raw: WebSocket.RawData) => {
        try {
          const frame = JSON.parse(raw.toString("utf8")) as ControlFrame & { canEdit?: boolean };
          if (frame.type === "sync-init") {
            clearTimeout(timeout);
            resolve(frame);
          }
        } catch {
          // ignore binary frames
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect((initFrame as { canEdit?: boolean }).canEdit).toBe(false);
    ws.close();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 15 (F-03): Binary structural validation & malformed payload rejection
  // ---------------------------------------------------------------------------
  it("15. [F-03] Rejects corrupt updates (400) and structurally validates binary without full doc clone", async () => {
    const { post } = await setupRestorablePost("BinaryValidation");

    // 15a: Non-base64 garbage
    const garbageRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: "not-a-valid-base64-payload!!!" },
    });
    expect(garbageRes.statusCode).toBe(400);

    // 15b: Valid base64 but corrupted Yjs binary
    const corruptBinaryB64 = Buffer.from([0x00, 0xff, 0xfe, 0xfd, 0x12, 0x34]).toString("base64");
    const corruptRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: corruptBinaryB64 },
    });
    expect(corruptRes.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 16 (F-04): CSRF Origin validation on cookie-auth mutating routes
  // ---------------------------------------------------------------------------
  it("16. [F-04] Rejects cookie-auth mutating requests without trusted Origin (403)", async () => {
    const { post } = await setupRestorablePost("OriginCsrf");
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "CSRF_TEST");
    const validB64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

    // 16a: Untrusted origin with cookie auth -> 403
    const untrustedRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "https://evil-attacker.example.com",
      },
      payload: { update: validB64 },
    });
    expect(untrustedRes.statusCode).toBe(403);

    // 16b: Missing origin with cookie-only auth -> 403
    const missingOriginRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
      },
      payload: { update: validB64 },
    });
    expect(missingOriginRes.statusCode).toBe(403);

    // 16c: Trusted origin with cookie auth -> 200
    const trustedRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: validB64 },
    });
    expect(trustedRes.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 17 (P0-1): Routine PUT /posts/:id autosave snapshot preservation
  // ---------------------------------------------------------------------------
  it("17. [P0-1] Routine PUT /posts/:id saves do not wipe crdt:snapshot or drop active session updates", async () => {
    const { post } = await setupRestorablePost("AutosavePreserve");

    // Send a CRDT update
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "PERSISTENT_CRDT_DATA");
    const updateB64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

    const crdtRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/posts/${post.id}/collaboration/crdt`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: { update: updateB64 },
    });
    expect(crdtRes.statusCode).toBe(200);

    // Execute routine REST PUT /posts/:id
    const updatedTitle = `AutosavePreserve Saved ${randomUUID().slice(0, 6)}`;
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/admin/v1/posts/${post.id}`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        cookie: `vibress_session=${sessionToken}`,
        "x-publication-id": publicationId,
        origin: "http://localhost:7777",
      },
      payload: {
        title: updatedTitle,
        expectedVersion: post.version,
      },
    });
    expect(putRes.statusCode).toBe(200);

    // Verify updates and epoch are still valid and active in Redis
    const epoch = await crdtPersistence.getEpoch(publicationId, post.id);
    expect(epoch).toBeGreaterThanOrEqual(1);
    const updates = await crdtPersistence.getUpdates(publicationId, post.id);
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 18 (P0-2): Monotonic room barrier and protection against epoch regression
  // ---------------------------------------------------------------------------
  it("18. [P0-2] room.epoch is strictly monotonic and cannot regress during hydration races", async () => {
    const { post, revV1 } = await setupRestorablePost("MonotonicEpoch");
    const restored = await restoreToRevision(post.id, revV1.id);
    expect(restored.epoch).toBeGreaterThanOrEqual(2);

    // Acquire or inspect the room in memory
    const room = await roomManager.getOrCreateRoom(publicationId, post.id);
    expect(room.epoch).toBe(restored.epoch);

    // Attempting to hydrate from a stale state does not regress epoch
    await room.hydrateFromDurableState({
      snapshot: new Uint8Array(),
      updates: [],
      epoch: 1, // Stale epoch attempt
      generationId: "stale-gen",
      revokedClientIds: [],
    });

    expect(room.epoch).toBe(restored.epoch); // Must NOT have regressed to 1!
  });
});
