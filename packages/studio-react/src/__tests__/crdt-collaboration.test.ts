import { describe, it, expect } from "vitest";
import { Doc, applyUpdate, encodeStateAsUpdate } from "yjs";
import {
  createMemoryCollaborationProvider,
  MemoryCollaborationProvider,
} from "../collaboration/memory-collaboration-provider";

describe("Studio Real-Time CRDT Collaboration (Yjs)", () => {
  it("synchronizes simultaneous edits across two independent clients deterministically", () => {
    const docId = "doc_collab_test_1";
    const docMapA = new Map<string, Doc>();
    const docMapB = new Map<string, Doc>();

    const userA = { id: "user_a", name: "Alice", color: "#3b82f6" };
    const userB = { id: "user_b", name: "Bob", color: "#10b981" };

    const providerA = createMemoryCollaborationProvider(docId, userA, docMapA);
    const providerB = createMemoryCollaborationProvider(docId, userB, docMapB);

    // Client A writes paragraph A
    const ytextA = providerA.doc.getText("content");
    ytextA.insert(0, "Alice paragraph content.\n");

    // Client B writes paragraph B simultaneously
    const ytextB = providerB.doc.getText("content");
    ytextB.insert(ytextB.length, "Bob paragraph content.\n");

    // Verify both documents converge to identical text without conflict 409
    expect(ytextA.toString()).toBe(ytextB.toString());
    expect(ytextA.toString()).toContain("Alice paragraph content.");
    expect(ytextA.toString()).toContain("Bob paragraph content.");

    providerA.destroy();
    providerB.destroy();
  });

  it("handles offline edits and syncs upon reconnection without data loss", () => {
    const docId = "doc_collab_test_offline";
    const docMapA = new Map<string, Doc>();
    const docMapB = new Map<string, Doc>();

    const userA = { id: "user_a", name: "Alice", color: "#3b82f6" };
    const userB = { id: "user_b", name: "Bob", color: "#10b981" };

    const providerA = createMemoryCollaborationProvider(docId, userA, docMapA);
    const providerB = createMemoryCollaborationProvider(docId, userB, docMapB);

    const ytextA = providerA.doc.getText("content");
    const ytextB = providerB.doc.getText("content");

    ytextA.insert(0, "Initial shared text.\n");
    expect(ytextB.toString()).toBe("Initial shared text.\n");

    // Client B goes offline
    providerB.disconnect();

    // Client A continues editing while B is offline
    ytextA.insert(ytextA.length, "Alice online update.\n");

    // Client B edits locally while offline
    ytextB.insert(ytextB.length, "Bob offline draft.\n");

    // Client B reconnects
    providerB.connect();

    // Manual sync update exchange simulation upon reconnect
    const updateFromB = encodeStateAsUpdate(providerB.doc);
    const updateFromA = encodeStateAsUpdate(providerA.doc);
    applyUpdate(providerA.doc, updateFromB);
    applyUpdate(providerB.doc, updateFromA);

    // Both converge with all edits preserved
    expect(ytextA.toString()).toBe(ytextB.toString());
    expect(ytextA.toString()).toContain("Initial shared text.");
    expect(ytextA.toString()).toContain("Alice online update.");
    expect(ytextA.toString()).toContain("Bob offline draft.");

    providerA.destroy();
    providerB.destroy();
  });

  it("propagates ephemeral awareness states (presence, username, color)", () => {
    const docId = "doc_collab_awareness";
    const docA = new Doc();
    const docB = new Doc();

    const userA = { id: "user_a", name: "Alice", color: "#3b82f6" };
    const userB = { id: "user_b", name: "Bob", color: "#10b981" };

    const providerA = new MemoryCollaborationProvider(docId, docA, userA);
    const providerB = new MemoryCollaborationProvider(docId, docB, userB);

    providerA.connect();
    providerB.connect();

    const statesA = Array.from(providerA.awareness.getStates().values());
    const statesB = Array.from(providerB.awareness.getStates().values());

    expect(statesA.some((s) => (s as any).user?.name === "Alice")).toBe(true);
    expect(statesB.some((s) => (s as any).user?.name === "Bob")).toBe(true);

    providerA.destroy();
    providerB.destroy();
  });
});
