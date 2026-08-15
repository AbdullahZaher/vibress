import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@vibress/config";

describe("Typed configuration", () => {
  it("loads safe development defaults", () => {
    const config = loadConfig({ NODE_ENV: "development" });

    expect(config.env).toBe("development");
    expect(config.database.url).toContain("postgresql://");
    expect(config.redis.url).toContain("redis://");
    expect(config.cors.origin).toBe(true);
    expect(config.cors.staffAllowedOrigins).toContain("http://localhost:7777");
    expect(config.cookies.secure).toBe(false);
    expect(config.outbox.deliveryMode).toBe("outbox");
  });

  it("rejects production without required secrets and origins", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);

    try {
      loadConfig({ NODE_ENV: "production" });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const issues = (err as ConfigError).issues.join("\n");
      expect(issues).toContain("VIBRESS_ENCRYPTION_KEY");
      expect(issues).toContain("NEWSLETTER_UNSUBSCRIBE_SECRET");
      expect(issues).toContain("STRIPE_SECRET_KEY");
      expect(issues).toContain("STRIPE_WEBHOOK_SECRET");
      expect(issues).toContain("CORS_ORIGINS");
      expect(issues).toContain("VIBRESS_SETUP_TOKEN");
    }
  });

  it("loads production with explicit secrets and CORS origins", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      VIBRESS_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      NEWSLETTER_UNSUBSCRIBE_SECRET: "newsletter-prod-secret",
      STRIPE_SECRET_KEY: "sk_live_real",
      STRIPE_WEBHOOK_SECRET: "whsec_real",
      CORS_ORIGINS: "https://admin.example.com,https://portal.example.com",
      ADMIN_ORIGIN: "https://admin.example.com/",
      PORTAL_ORIGIN: "https://portal.example.com/",
      VIBRESS_SETUP_TOKEN: "prod-setup-token-0123456789abcdef0123456789abcdef",
    });

    expect(config.isProduction).toBe(true);
    expect(config.cookies.secure).toBe(true);
    expect(config.cors.origin).toEqual([
      "https://admin.example.com",
      "https://portal.example.com",
    ]);
    expect(config.cors.staffAllowedOrigins).not.toContain(
      "http://localhost:7777",
    );
    expect(config.cors.memberAllowedOrigins).not.toContain(
      "http://localhost:7777",
    );
  });

  it("rejects invalid URLs and invalid delivery modes", () => {
    expect(() => loadConfig({ SITE_URL: "not-a-url" })).toThrow(ConfigError);
    expect(() => loadConfig({ EVENT_DELIVERY_MODE: "sideways" })).toThrow(
      ConfigError,
    );
    expect(() =>
      loadConfig({ CORS_ORIGINS: "https://ok.example.com,not-a-url" }),
    ).toThrow(ConfigError);
  });

  it("defaults observability to enabled and respects explicit overrides", () => {
    const defaults = loadConfig({ NODE_ENV: "development" });
    expect(defaults.observability.metricsEnabled).toBe(true);
    expect(defaults.observability.tracingEnabled).toBe(true);

    const disabled = loadConfig({
      NODE_ENV: "development",
      METRICS_ENABLED: "false",
      TRACING_ENABLED: "false",
    });
    expect(disabled.observability.metricsEnabled).toBe(false);
    expect(disabled.observability.tracingEnabled).toBe(false);
  });
});
