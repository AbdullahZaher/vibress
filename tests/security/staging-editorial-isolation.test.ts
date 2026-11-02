import { describe, it, expect, vi } from "vitest";
import {
  verifyStagingMarker,
  provisionStagingMarker,
  StagingIsolationError,
  STAGING_IDENTITY_TABLE,
} from "../../scripts/seed-theme-editorial-content";

describe("Editorial Staging Database Isolation (P1)", () => {
  const validEnv = {
    NODE_ENV: "development",
    VIBRESS_SEED_EDITORIAL_STAGING: "true",
    DATABASE_URL: "postgresql://vibress:vibress@127.0.0.1:5433/vibress",
  };

  it("fails closed when VIBRESS_SEED_EDITORIAL_STAGING is missing or invalid", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
        env: { NODE_ENV: "development", VIBRESS_SEED_EDITORIAL_STAGING: undefined },
      }),
    ).rejects.toThrow(StagingIsolationError);

    await expect(
      verifyStagingMarker(mockClient, {
        env: { NODE_ENV: "development", VIBRESS_SEED_EDITORIAL_STAGING: "false" },
      }),
    ).rejects.toThrow(StagingIsolationError);

    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it("unconditionally rejects execution in production environments", async () => {
    const mockClient = { query: vi.fn() };

    await expect(
      verifyStagingMarker(mockClient, {
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
          env: {
            NODE_ENV: "development",
            VIBRESS_SEED_EDITORIAL_STAGING: "true",
            DATABASE_URL: url,
          },
        }),
      ).rejects.toThrow(/Target database URL matches forbidden cloud\/production pattern/);
    }
  });

  it("fails closed when staging identity table is missing from database", async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error(`relation "${STAGING_IDENTITY_TABLE}" does not exist`)),
    };

    await expect(
      verifyStagingMarker(mockClient, { env: validEnv }),
    ).rejects.toThrow(/Staging identity table "_staging_environment_identity" is missing or inaccessible/);
  });

  it("fails closed when identity marker row is missing", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await expect(
      verifyStagingMarker(mockClient, { env: validEnv }),
    ).rejects.toThrow("Database does not contain a verified staging environment identity marker row.");
  });

  it("rejects unauthorized environment types such as 'production' or 'shared'", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "singleton",
            environment_type: "production",
            marker_token: "token123",
            authorized_target_publication_id: "pub_default",
            provisioned_at: new Date(),
          },
        ],
      }),
    };

    await expect(
      verifyStagingMarker(mockClient, { env: validEnv }),
    ).rejects.toThrow('Invalid staging database environment type: "production"');
  });

  it("fails closed on marker token mismatch", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "singleton",
            environment_type: "disposable_development",
            marker_token: "expected-token-aaa",
            authorized_target_publication_id: "pub_default",
            provisioned_at: new Date(),
          },
        ],
      }),
    };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: "different-token-bbb",
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
            marker_token: "token123",
            authorized_target_publication_id: "pub_other",
            provisioned_at: new Date(),
          },
        ],
      }),
    };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: "token123",
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
              marker_token: "token123",
              authorized_target_publication_id: "pub_default",
              provisioned_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }), // pubResult
    };

    await expect(
      verifyStagingMarker(mockClient, {
        markerToken: "token123",
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
              marker_token: "token123",
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
      markerToken: "token123",
      targetPublicationId: "pub_default",
      env: validEnv,
    });

    expect(identity.environmentType).toBe("disposable_development");
    expect(identity.markerToken).toBe("token123");
    expect(identity.authorizedTargetPublicationId).toBe("pub_default");
  });

  it("provisions staging marker with valid schema and inserts singleton row", async () => {
    const mockClient = { query: vi.fn().mockResolvedValue({}) };

    const result = await provisionStagingMarker(mockClient, {
      markerToken: "custom-token-xyz",
      targetPublicationId: "pub_default",
      environmentType: "ephemeral_test",
    });

    expect(result.markerToken).toBe("custom-token-xyz");
    expect(result.environmentType).toBe("ephemeral_test");
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(mockClient.query.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS _staging_environment_identity");
    expect(mockClient.query.mock.calls[1][0]).toContain("INSERT INTO _staging_environment_identity");
  });
});
