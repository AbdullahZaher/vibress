import { describe, it, expect, vi } from "vitest";
import {
  verifyStagingMarker,
  seedEditorialContent,
  StagingIsolationError,
  STAGING_IDENTITY_TABLE,
} from "../../scripts/seed-theme-editorial-content";
import { provisionStagingMarker } from "../../scripts/provision-staging-marker";

describe("Editorial Staging Database Isolation (P1)", () => {
  const validToken = "a".repeat(64);
  const differentValidToken = "b".repeat(64);

  const validEnv = {
    NODE_ENV: "development",
    VIBRESS_SEED_EDITORIAL_STAGING: "true",
    VIBRESS_STAGING_MARKER_TOKEN: validToken,
    DATABASE_URL: "postgresql://vibress:vibress@127.0.0.1:5433/vibress",
  };

  it("fails closed when VIBRESS_SEED_EDITORIAL_STAGING is missing or invalid", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: validToken,
        env: { NODE_ENV: "development", VIBRESS_SEED_EDITORIAL_STAGING: undefined },
      }),
    ).rejects.toThrow(StagingIsolationError);

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: validToken,
        env: { NODE_ENV: "development", VIBRESS_SEED_EDITORIAL_STAGING: "false" },
      }),
    ).rejects.toThrow(StagingIsolationError);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("unconditionally rejects execution in production environments", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: validToken,
        env: { NODE_ENV: "production", VIBRESS_SEED_EDITORIAL_STAGING: "true" },
      }),
    ).rejects.toThrow(
      "Editorial staging seeder is strictly forbidden when NODE_ENV=production. Overrides are not permitted.",
    );

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("rejects database URLs pointing to cloud or managed targets", async () => {
    const mockClient = { query: vi.fn() };
    const cloudUrls = [
      "postgresql://app:secret@db.prod.company.com:5432/vibress",
      "postgresql://user:pass@vibress-production.c12345.us-east-1.rds.amazonaws.com/vibress",
      "postgresql://user:pass@ep-cool-butterfly-1234.us-east-2.aws.neon.tech/vibress",
      "postgresql://postgres:pass@db.abcdefgh.supabase.co:5432/postgres",
      "postgresql://user:pass@railway.app:5432/vibress",
      "postgresql://user:pass@render.com:5432/vibress",
    ];

    for (const url of cloudUrls) {
      await expect(
        verifyStagingMarker(mockClient, {
          markerToken: validToken,
          env: {
            NODE_ENV: "development",
            VIBRESS_SEED_EDITORIAL_STAGING: "true",
            DATABASE_URL: url,
          },
        }),
      ).rejects.toThrow(/Target database URL matches forbidden cloud\/production pattern/);
    }
  });

  it("denies unidentified remote seeding targets before reading their database identity", async () => {
    const mockClient = { query: vi.fn() };
    await expect(verifyStagingMarker(mockClient, { markerToken: validToken,
      env: { ...validEnv, DATABASE_URL: "postgresql://user:pass@customer.internal.example:5432/db" },
    })).rejects.toThrow(/dedicated localhost/);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("fails closed when expected marker token is missing entirely", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
        env: {
          ...validEnv,
          VIBRESS_STAGING_MARKER_TOKEN: undefined,
        },
      }),
    ).rejects.toThrow(/Missing expected staging marker token/);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("fails closed when expected marker token is empty or whitespace", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: "   ",
        env: validEnv,
      }),
    ).rejects.toThrow(/Missing expected staging marker token/);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("fails closed when expected marker token is malformed (not 64 hex chars)", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: "short-token-123",
        env: validEnv,
      }),
    ).rejects.toThrow(/Malformed staging marker token/);

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: "g".repeat(64), // invalid hex char
        env: validEnv,
      }),
    ).rejects.toThrow(/Malformed staging marker token/);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("fails closed when staging identity table is missing from database", async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error(`relation "${STAGING_IDENTITY_TABLE}" does not exist`)),
    };

    await expect(
      verifyStagingMarker(mockClient, { markerToken: validToken, env: validEnv }),
    ).rejects.toThrow(/Staging identity table "_staging_environment_identity" is missing or inaccessible/);
  });

  it("fails closed when identity marker row is missing", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await expect(
      verifyStagingMarker(mockClient, { markerToken: validToken, env: validEnv }),
    ).rejects.toThrow("Database does not contain a verified staging environment identity marker row.");
  });

  it("rejects unauthorized environment types such as 'production' or 'shared'", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "singleton",
            environment_type: "production",
            marker_token: validToken,
            authorized_target_publication_id: "pub_default",
            provisioned_at: new Date(),
          },
        ],
      }),
    };

    await expect(
      verifyStagingMarker(mockClient, { markerToken: validToken, env: validEnv }),
    ).rejects.toThrow('Invalid staging database environment type: "production"');
  });

  it("fails closed on marker token mismatch", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "singleton",
            environment_type: "disposable_development",
            marker_token: validToken,
            authorized_target_publication_id: "pub_default",
            provisioned_at: new Date(),
          },
        ],
      }),
    };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: differentValidToken,
        env: validEnv,
      }),
    ).rejects.toThrow("Staging environment marker token mismatch.");
  });

  it("fails closed when target publication is not authorized for staging seeding", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "singleton",
            environment_type: "disposable_development",
            marker_token: validToken,
            authorized_target_publication_id: "pub_other",
            provisioned_at: new Date(),
          },
        ],
      }),
    };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: validToken,
        targetPublicationId: "pub_default",
        env: validEnv,
      }),
    ).rejects.toThrow('Database is not authorized for target publication "pub_default"');
  });

  it("fails closed when target publication row does not exist in target database", async () => {
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "singleton",
              environment_type: "disposable_development",
              marker_token: validToken,
              authorized_target_publication_id: "pub_default",
              provisioned_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }), // pubResult
    };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: validToken,
        targetPublicationId: "pub_default",
        env: validEnv,
      }),
    ).rejects.toThrow('Target publication "pub_default" does not exist in target database.');
  });

  it("successfully validates an authentic disposable staging database", async () => {
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "singleton",
              environment_type: "disposable_development",
              marker_token: validToken,
              authorized_target_publication_id: "pub_default",
              provisioned_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: "pub_default", name: "The Vibress Chronicle" }],
        }),
    };

    const identity = await verifyStagingMarker(mockClient, {
      markerToken: validToken,
      targetPublicationId: "pub_default",
      env: validEnv,
    });

    expect(identity.environmentType).toBe("disposable_development");
    expect(identity.markerToken).toBe(validToken);
    expect(identity.authorizedTargetPublicationId).toBe("pub_default");
  });

  it("provisions staging marker in dedicated workflow only when explicitly authorized", async () => {
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "pub_default" }] }) // check publication
        .mockResolvedValueOnce({}) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [{ id: "singleton" }] }), // INSERT INTO
    };

    const result = await provisionStagingMarker(mockClient, {
      markerToken: validToken,
      targetPublicationId: "pub_default",
      environmentType: "ephemeral_test",
      env: {
        NODE_ENV: "development",
        VIBRESS_PROVISION_STAGING_MARKER: "true",
        DATABASE_URL: "postgresql://vibress:vibress@127.0.0.1:5433/vibress",
      },
    });

    expect(result.markerToken).toBe(validToken);
    expect(result.environmentType).toBe("ephemeral_test");
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    expect(mockClient.query.mock.calls[0][0]).toContain("SELECT id FROM publications");
    expect(mockClient.query.mock.calls[1][0]).toContain("CREATE TABLE IF NOT EXISTS _staging_environment_identity");
    expect(mockClient.query.mock.calls[2][0]).toContain("INSERT INTO _staging_environment_identity");
    expect(mockClient.query.mock.calls[2][0]).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("rejects staging marker provisioning without VIBRESS_PROVISION_STAGING_MARKER=true", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      provisionStagingMarker(mockClient, {
        markerToken: validToken,
        env: {
          NODE_ENV: "development",
          VIBRESS_PROVISION_STAGING_MARKER: "false",
        },
      }),
    ).rejects.toThrow(/Staging marker provisioning requires deliberate opt-in/);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("rejects staging marker provisioning in production environments", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      provisionStagingMarker(mockClient, {
        markerToken: validToken,
        env: {
          NODE_ENV: "production",
          VIBRESS_PROVISION_STAGING_MARKER: "true",
        },
      }),
    ).rejects.toThrow(/Provisioning a staging marker is strictly forbidden when NODE_ENV=production/);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("refuses to replace an existing database authorization marker", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "pub_default" }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] }),
    };
    await expect(provisionStagingMarker(client, { markerToken: validToken,
      env: { NODE_ENV: "development", VIBRESS_PROVISION_STAGING_MARKER: "true",
        DATABASE_URL: "postgresql://vibress:vibress@127.0.0.1:5433/vibress" },
    })).rejects.toThrow(/already exists/);
  });

  it("refuses provisioning to unrecognized private or remote hosts", async () => {
    const client = { query: vi.fn() };
    await expect(provisionStagingMarker(client, { markerToken: validToken,
      env: { NODE_ENV: "development", VIBRESS_PROVISION_STAGING_MARKER: "true",
        DATABASE_URL: "postgresql://x:y@customer-db.internal.example:5432/vibress" },
    })).rejects.toThrow(/localhost disposable/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("never mutates shared user profiles or unrelated posts during editorial seeding", async () => {
    const { seedStatements } = await import("../../scripts/seed-theme-editorial-content");
    const sql = seedStatements.join("\n");
    expect(sql).not.toContain("UPDATE users SET");
    expect(sql).not.toContain("SELECT id FROM users LIMIT 1");
    expect(sql).not.toContain("UPDATE posts SET status = 'draft'");
    expect(sql).not.toContain("DELETE FROM post_tags WHERE publication_id = 'pub_default';");
  });

  it("rolls back transactions on error during editorial seeding", async () => {
    const mockClient = {
      query: vi.fn()
        // verifyStagingMarker queries:
        .mockResolvedValueOnce({
          rows: [
            {
              id: "singleton",
              environment_type: "disposable_development",
              marker_token: validToken,
              authorized_target_publication_id: "pub_default",
              provisioned_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "pub_default" }] })
        // BEGIN
        .mockResolvedValueOnce({})
        // First statement fails
        .mockRejectedValueOnce(new Error("Database connection interrupted during mutation"))
        // ROLLBACK
        .mockResolvedValueOnce({}),
    };

    await expect(
      seedEditorialContent(mockClient, {
        markerToken: validToken,
        env: validEnv,
      }),
    ).rejects.toThrow("Database connection interrupted during mutation");

    const queryCalls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(queryCalls).toContain("BEGIN;");
    expect(queryCalls).toContain("ROLLBACK;");
    expect(queryCalls).not.toContain("COMMIT;");
  });
});
