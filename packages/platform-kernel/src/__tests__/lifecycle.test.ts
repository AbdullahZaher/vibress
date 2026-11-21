import { describe, expect, it } from "vitest";
import {
  ApplicationLifecycleError,
  createApplicationLifecycle,
  isTerminalLifecycle,
  transitionApplicationLifecycle,
} from "../lifecycle";
import {
  asApplicationId,
  asInstallationId,
  asWorkspaceId,
  InvalidPlatformIdentityError,
  LEGACY_PUBLICATION_FALLBACK,
} from "../identity";

const applicationId = asApplicationId("crm-app");
const installationId = asInstallationId("install-a");
const digest = "a".repeat(64);
const secondDigest = "b".repeat(64);

function lifecycle() {
  return createApplicationLifecycle({
    applicationId,
    installationId,
    manifestDigest: digest,
    schemaRevision: "rev-1",
  });
}

function identity(lifecycleRevision: number, overrides: Record<string, unknown> = {}) {
  return {
    applicationId,
    installationId,
    expectedRevision: lifecycleRevision,
    ...overrides,
  };
}

describe("M01 public lifecycle and identity contracts", () => {
  it("introduces a branded Workspace identity that rejects the legacy fallback", () => {
    expect(asWorkspaceId("ws_alpha")).toBe("ws_alpha");
    expect(() => asWorkspaceId(LEGACY_PUBLICATION_FALLBACK)).toThrow(
      InvalidPlatformIdentityError,
    );
    expect(() => asWorkspaceId("UPPERCASE")).toThrow(InvalidPlatformIdentityError);
  });

  it("creates a registered lifecycle with pinned evidence", () => {
    const created = lifecycle();
    expect(created.state).toBe("REGISTERED");
    expect(created.revision).toBe(0);
    expect(created.manifestDigest).toBe(digest);
    expect(Object.isFrozen(created)).toBe(true);
  });

  it("rejects invalid manifest and schema evidence", () => {
    expect(() =>
      createApplicationLifecycle({
        applicationId,
        installationId,
        manifestDigest: "not-a-digest",
        schemaRevision: "rev-1",
      }),
    ).toThrow(/sha256/);
    expect(() =>
      createApplicationLifecycle({
        applicationId,
        installationId,
        manifestDigest: digest,
        schemaRevision: "",
      }),
    ).toThrow(/non-empty/);
  });

  it("walks the legal install/activate/suspend/resume/remove path", () => {
    let current = lifecycle();
    current = transitionApplicationLifecycle(current, "install", identity(0));
    expect(current.state).toBe("INSTALLED");
    current = transitionApplicationLifecycle(current, "activate", identity(1));
    expect(current.state).toBe("ACTIVE");
    current = transitionApplicationLifecycle(current, "suspend", identity(2));
    current = transitionApplicationLifecycle(current, "resume", identity(3));
    expect(current.state).toBe("ACTIVE");
    current = transitionApplicationLifecycle(current, "remove", identity(4));
    expect(isTerminalLifecycle(current)).toBe(true);
    expect(current.history).toEqual([
      "install",
      "activate",
      "suspend",
      "resume",
      "remove",
    ]);
  });

  it("rejects invalid transitions and terminal reuse", () => {
    const current = lifecycle();
    expect(() =>
      transitionApplicationLifecycle(current, "activate", identity(0)),
    ).toThrow(ApplicationLifecycleError);
    const removed = transitionApplicationLifecycle(
      current,
      "remove",
      identity(0),
    );
    expect(() =>
      transitionApplicationLifecycle(removed, "install", identity(1)),
    ).toThrow(/not allowed/);
  });

  it("enforces compare-and-swap and installation binding", () => {
    const installed = transitionApplicationLifecycle(
      lifecycle(),
      "install",
      identity(0),
    );
    expect(() =>
      transitionApplicationLifecycle(installed, "activate", identity(0)),
    ).toThrow(/REVISION_CONFLICT|expected revision/);
    expect(() =>
      transitionApplicationLifecycle(
        installed,
        "activate",
        identity(1, { installationId: asInstallationId("install-b") }),
      ),
    ).toThrow(/IDENTITY_MISMATCH|does not match/);
  });

  it("binds upgrades to new signed evidence", () => {
    const active = transitionApplicationLifecycle(
      transitionApplicationLifecycle(lifecycle(), "install", identity(0)),
      "activate",
      identity(1),
    );
    expect(() =>
      transitionApplicationLifecycle(active, "upgrade", identity(2)),
    ).toThrow(/sha256/);
    const upgraded = transitionApplicationLifecycle(
      active,
      "upgrade",
      identity(2, { manifestDigest: secondDigest, schemaRevision: "rev-2" }),
    );
    expect(upgraded.manifestDigest).toBe(secondDigest);
    expect(upgraded.schemaRevision).toBe("rev-2");
    expect(upgraded.revision).toBe(3);
  });
});
