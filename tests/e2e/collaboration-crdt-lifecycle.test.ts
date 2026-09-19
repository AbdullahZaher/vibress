import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import * as Y from "yjs";
import { getRedisClient, buildPublicationCacheKey } from "@vibress/cache";
import { getDb, posts, seedFixturePost } from "@vibress/database";
import { eq } from "drizzle-orm";

const PUBLICATION_ID = "pub_default";
const TARGET_POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";

test.describe("CRDT Room Lifecycle & Stale Buffer Resilience", () => {
  test("Tests all 5 CRDT room lifecycle scenarios: stale Redis buffer, 2nd peer catchup, peer disconnect cleanup, new peer after cleanup, REST save while WS active", async ({
    request,
  }) => {
    await seedFixturePost();
    const redis = getRedisClient();
    const redisUpdatesKey = buildPublicationCacheKey(PUBLICATION_ID, "crdt:updates", TARGET_POST_ID);

    // ============================================================
    // SCENARIO 1: First peer receives durable Redis buffer
    // ============================================================
    console.log("--- SCENARIO 1: First peer receives durable Redis buffer ---");
    // Ensure clean start
    await redis.del(redisUpdatesKey);
    // Inject a valid Y.Doc update into Redis
    const seededDoc = new Y.Doc();
    const seededText = seededDoc.getText("content");
    seededText.insert(0, "DURABLE_SEEDED_PARAGRAPH");
    const seededBytes = Y.encodeStateAsUpdate(seededDoc);
    const seededB64 = Buffer.from(seededBytes).toString("base64");
    await redis.rpush(redisUpdatesKey, seededB64);

    const redisItemsBefore = await redis.lrange(redisUpdatesKey, 0, -1);
    expect(redisItemsBefore.length).toBeGreaterThan(0);
    console.log(`Injected durable CRDT update into Redis: ${redisUpdatesKey}`);

    // Connect Peer 1 via WebSocket
    const wsUrl = `ws://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}/collaboration/ws`;
    
    // Authenticate by obtaining session cookie from login
    const loginRes = await request.post("http://localhost:7780/api/admin/v1/auth/login", {
      data: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });
    expect(loginRes.status()).toBe(200);
    const setCookie = loginRes.headers()["set-cookie"] || "";
    const sessionCookie = setCookie.split(";")[0];

    const receivedByPeer1: Uint8Array[] = [];
    const peer1 = new WebSocket(wsUrl, {
      headers: {
        Cookie: sessionCookie,
      },
    });

    await new Promise<void>((resolve, reject) => {
      peer1.on("open", () => {
        console.log("Peer 1 connected to WebSocket.");
        resolve();
      });
      peer1.on("error", reject);
      peer1.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary && Buffer.isBuffer(data)) {
          receivedByPeer1.push(new Uint8Array(data));
        }
      });
    });

    // Allow time for server to handle initial connection
    await new Promise((r) => setTimeout(r, 600));

    // VERIFY: Peer 1 receives the durable update stream
    console.log(`Peer 1 received initial updates: ${receivedByPeer1.length}`);
    expect(receivedByPeer1.length).toBeGreaterThan(0);
    const doc1 = new Y.Doc();
    for (const u of receivedByPeer1) {
      Y.applyUpdate(doc1, u);
    }
    expect(doc1.getText("content").toString()).toContain("DURABLE_SEEDED_PARAGRAPH");

    // ============================================================
    // SCENARIO 2: Second peer joining active room
    // ============================================================
    console.log("--- SCENARIO 2: Second peer joining active room ---");
    // Peer 1 sends an update to the active room
    const liveDoc = new Y.Doc();
    const liveText = liveDoc.getText("content");
    liveText.insert(0, "LIVE_COLLAB_PARAGRAPH_UPDATE");
    const liveBytes = Y.encodeStateAsUpdate(liveDoc);

    peer1.send(liveBytes, { binary: true });
    // Wait for server to record update in room
    await new Promise((r) => setTimeout(r, 600));

    // Connect Peer 2
    const receivedByPeer2: Uint8Array[] = [];
    const peer2 = new WebSocket(wsUrl, {
      headers: {
        Cookie: sessionCookie,
      },
    });

    await new Promise<void>((resolve, reject) => {
      peer2.on("open", () => {
        console.log("Peer 2 connected to active room.");
        resolve();
      });
      peer2.on("error", reject);
      peer2.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary && Buffer.isBuffer(data)) {
          receivedByPeer2.push(new Uint8Array(data));
        }
      });
    });

    // Wait for catch-up synchronization
    await new Promise((r) => setTimeout(r, 600));

    // VERIFY: Peer 2 MUST have received the live catch-up update
    console.log(`Peer 2 received catch-up updates: ${receivedByPeer2.length}`);
    expect(receivedByPeer2.length).toBeGreaterThan(0);

    const receivedDoc = new Y.Doc();
    for (const update of receivedByPeer2) {
      Y.applyUpdate(receivedDoc, update);
    }
    const decodedText = receivedDoc.getText("content").toString();
    console.log(`Peer 2 decoded catch-up content: "${decodedText}"`);
    expect(decodedText).toContain("LIVE_COLLAB_PARAGRAPH_UPDATE");

    // ============================================================
    // SCENARIO 3: All peers disconnect (updates persist in Redis)
    // ============================================================
    console.log("--- SCENARIO 3: All peers disconnect ---");
    peer1.close();
    peer2.close();
    // Wait for server close events to fire and remove peers
    await new Promise((r) => setTimeout(r, 800));

    // VERIFY: Updates persist in Redis across client disconnects
    const redisAfterDisconnect = await redis.lrange(redisUpdatesKey, 0, -1);
    console.log(`Redis items after all peers disconnected: ${redisAfterDisconnect.length}`);
    expect(redisAfterDisconnect.length).toBeGreaterThan(0);

    // ============================================================
    // SCENARIO 4: New peer joins after disconnect and recovers state
    // ============================================================
    console.log("--- SCENARIO 4: New peer joins after disconnect ---");
    const receivedByPeer3: Uint8Array[] = [];
    const peer3 = new WebSocket(wsUrl, {
      headers: {
        Cookie: sessionCookie,
      },
    });

    await new Promise<void>((resolve, reject) => {
      peer3.on("open", () => {
        console.log("Peer 3 connected after disconnect.");
        resolve();
      });
      peer3.on("error", reject);
      peer3.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary && Buffer.isBuffer(data)) {
          receivedByPeer3.push(new Uint8Array(data));
        }
      });
    });

    await new Promise((r) => setTimeout(r, 600));
    // VERIFY: Peer 3 receives the durable updates from Redis
    console.log(`Peer 3 initial updates received: ${receivedByPeer3.length}`);
    expect(receivedByPeer3.length).toBeGreaterThan(0);
    const doc3 = new Y.Doc();
    for (const u of receivedByPeer3) {
      Y.applyUpdate(doc3, u);
    }
    expect(doc3.getText("content").toString()).toContain("LIVE_COLLAB_PARAGRAPH_UPDATE");

    // ============================================================
    // SCENARIO 5: REST save while a WebSocket peer is active
    // ============================================================
    console.log("--- SCENARIO 5: REST save while WebSocket peer is active ---");
    // Peer 3 sends a mutation
    const peer3Doc = new Y.Doc();
    peer3Doc.getText("content").insert(0, "PEER3_UNSAVED_DRAFT");
    peer3.send(Y.encodeStateAsUpdate(peer3Doc), { binary: true });
    await new Promise((r) => setTimeout(r, 400));

    // Now execute REST PUT /posts/:id while Peer 3's WebSocket is still OPEN
    const db = getDb();
    const [dbPost] = await db.select().from(posts).where(eq(posts.id, TARGET_POST_ID));
    const currentVersion = dbPost.version;

    const restPutRes = await request.put(`http://localhost:7780/api/admin/v1/posts/${TARGET_POST_ID}`, {
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:7777",
      },
      data: {
        title: dbPost.title,
        content: dbPost.content,
        expectedVersion: currentVersion,
      },
    });
    expect(restPutRes.status()).toBe(200);
    const putJson = await restPutRes.json();
    console.log(`REST PUT succeeded with new version: ${putJson.post.version}`);
    expect(putJson.post.version).toBe(currentVersion + 1);

    // VERIFY: Peer 3 WebSocket remains open and functional
    expect(peer3.readyState).toBe(WebSocket.OPEN);

    // VERIFY: REST save authoritatively cleared CRDT buffer
    const redisAfterRestSave = await redis.lrange(redisUpdatesKey, 0, -1);
    console.log(`Redis items after authoritative REST save: ${redisAfterRestSave.length}`);
    expect(redisAfterRestSave.length).toBe(0);

    peer3.close();
    await new Promise((r) => setTimeout(r, 300));
    console.log("ALL 5 CRDT ROOM LIFECYCLE SCENARIOS PASSED!");
  });
});
