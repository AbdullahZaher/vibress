import { describe, expect, it } from "vitest";
import {
  issueNativeCursor,
  readNativeCursor,
  nativeFilterHash,
  type NativeCursorContext,
} from "../../apps/api/src/plugins/native-data-cursor";

describe("NUI-06 Multi-replica cursor continuity and secret rotation", () => {
  const sharedSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const rotatedSecret = "f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6b5a43210";
  const digest = "c".repeat(64);

  const context: NativeCursorContext = {
    pluginId: "lms-authoring",
    publicationId: "pub-primary",
    actorId: "staff-editor",
    resourceId: "courses",
    digest,
    filterHash: nativeFilterHash("status", "draft"),
  };

  it("allows Replica 2 to decrypt and decode a cursor issued by Replica 1 with identical shared secret", () => {
    const issuedAt = 1_000_000;
    // Replica 1 issues the cursor
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, issuedAt);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    // Replica 2 receives the cursor 5 seconds later
    const receivedAt = issuedAt + 5_000;
    const decodedId = readNativeCursor(cursor, context, sharedSecret, receivedAt);
    expect(decodedId).toBe("course-row-42");
  });

  it("fails closed across replicas when secret has been rotated without backward grace period", () => {
    const issuedAt = 1_000_000;
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, issuedAt);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    // Replica with rotated secret attempts to read
    const decodedId = readNativeCursor(cursor, context, rotatedSecret, issuedAt + 1_000);
    expect(decodedId).toBeNull();
  });

  it("rejects cursor replay across different publications even with identical shared key", () => {
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, 1_000_000);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const crossPubContext: NativeCursorContext = {
      ...context,
      publicationId: "pub-secondary",
    };
    expect(readNativeCursor(cursor, crossPubContext, sharedSecret, 1_001_000)).toBeNull();
  });

  it("rejects cursor replay across different actors/staff sessions", () => {
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, 1_000_000);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const crossActorContext: NativeCursorContext = {
      ...context,
      actorId: "staff-malicious",
    };
    expect(readNativeCursor(cursor, crossActorContext, sharedSecret, 1_001_000)).toBeNull();
  });

  it("rejects cursor reuse when filter parameter changes", () => {
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, 1_000_000);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const differentFilterContext: NativeCursorContext = {
      ...context,
      filterHash: nativeFilterHash("status", "published"),
    };
    expect(readNativeCursor(cursor, differentFilterContext, sharedSecret, 1_001_000)).toBeNull();
  });

  it("expires cursors after 15 minutes TTL", () => {
    const issuedAt = 1_000_000;
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, issuedAt);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    // Exactly 15 minutes + 1 ms later
    const expiredAt = issuedAt + 15 * 60 * 1000 + 1;
    expect(readNativeCursor(cursor, context, sharedSecret, expiredAt)).toBeNull();
  });
});
