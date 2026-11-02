import { describe, it, expect } from "vitest";
import {
  verifyStagingTargetEnvironment,
  StagingIsolationError,
} from "../../scripts/seed-theme-editorial-content";

describe("Editorial Staging Isolation Safeguards (P1)", () => {
  it("rejects execution when VIBRESS_SEED_EDITORIAL_STAGING is not set", () => {
    expect(() =>
      verifyStagingTargetEnvironment({
        NODE_ENV: "development",
        VIBRESS_SEED_EDITORIAL_STAGING: undefined,
      }),
    ).toThrow(StagingIsolationError);
  });

  it("rejects execution when VIBRESS_SEED_EDITORIAL_STAGING is false or invalid", () => {
    expect(() =>
      verifyStagingTargetEnvironment({
        NODE_ENV: "development",
        VIBRESS_SEED_EDITORIAL_STAGING: "false",
      }),
    ).toThrow(StagingIsolationError);

    expect(() =>
      verifyStagingTargetEnvironment({
        NODE_ENV: "development",
        VIBRESS_SEED_EDITORIAL_STAGING: "0",
      }),
    ).toThrow(StagingIsolationError);
  });

  it("unconditionally rejects execution in production environments", () => {
    expect(() =>
      verifyStagingTargetEnvironment({
        NODE_ENV: "production",
        VIBRESS_SEED_EDITORIAL_STAGING: "true",
      }),
    ).toThrow(StagingIsolationError);
  });

  it("rejects database URLs pointing to cloud, production, or managed targets", () => {
    const cloudUrls = [
      "postgresql://app:secret@db.prod.company.com:5432/vibress",
      "postgresql://user:pass@vibress-production.c12345.us-east-1.rds.amazonaws.com/vibress",
      "postgresql://user:pass@ep-cool-butterfly-1234.us-east-2.aws.neon.tech/vibress",
      "postgresql://postgres:pass@db.abcdefgh.supabase.co:5432/postgres",
      "postgresql://user:pass@railway.app:5432/vibress",
      "postgresql://user:pass@render.com:5432/vibress",
    ];

    for (const url of cloudUrls) {
      expect(() =>
        verifyStagingTargetEnvironment({
          NODE_ENV: "development",
          VIBRESS_SEED_EDITORIAL_STAGING: "true",
          DATABASE_URL: url,
        }),
      ).toThrow(StagingIsolationError);
    }
  });

  it("permits execution only when explicitly opted-in against local dev databases", () => {
    expect(() =>
      verifyStagingTargetEnvironment({
        NODE_ENV: "development",
        VIBRESS_SEED_EDITORIAL_STAGING: "true",
        DATABASE_URL: "postgresql://vibress:vibress@127.0.0.1:5433/vibress",
      }),
    ).not.toThrow();

    expect(() =>
      verifyStagingTargetEnvironment({
        NODE_ENV: "test",
        VIBRESS_SEED_EDITORIAL_STAGING: "true",
        DATABASE_URL: "postgresql://vibress:vibress@localhost:5432/vibress_test",
      }),
    ).not.toThrow();
  });
});

