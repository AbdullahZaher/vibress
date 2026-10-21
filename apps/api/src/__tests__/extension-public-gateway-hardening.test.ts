import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Production boundary contract. Never trust client-provided forwarded host or
 * x-real-ip; both are rewritten before Web/API receives external requests.
 * CDN/LB tiers in front must also preserve the authentic public Host.
 */
describe("EXT-302A production proxy tenant and visitor-IP contract", () => {
  it("overwrites X-Forwarded-Host at every upstream Host forwarding point", () => {
    const conf = readFileSync(
      resolve(process.cwd(), "infrastructure/nginx/nginx.prod.conf"), "utf8",
    );
    const hostForwardings = conf.match(/proxy_set_header Host \$host;/g) ?? [];
    const trustedHostForwardings = conf.match(/proxy_set_header X-Forwarded-Host \$host;/g) ?? [];
    expect(hostForwardings.length).toBeGreaterThan(0);
    expect(trustedHostForwardings).toHaveLength(hostForwardings.length);
    expect(conf).not.toMatch(/proxy_set_header X-Forwarded-Host \$http_x_forwarded_host;/);
  });

  it("rewrites client IP and forwarded-for instead of passing attacker values", () => {
    const conf = readFileSync(
      resolve(process.cwd(), "infrastructure/nginx/nginx.prod.conf"), "utf8",
    );
    const web = conf.slice(conf.indexOf("location / {"), conf.indexOf("location / {") + 650);
    expect(web).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(web).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(web).toContain("proxy_set_header X-Forwarded-Host $host;");
    expect(conf).not.toContain("proxy_set_header X-Forwarded-For $http_x_forwarded_for;");
  });
});
