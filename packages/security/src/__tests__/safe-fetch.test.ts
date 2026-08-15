import { describe, it, expect } from "vitest";
import {
  isPrivateIP,
  isSafeUrl,
  normalizeIP,
  safeFetch,
} from "../http/safe-fetch";

describe("SSRF Protection - IP & URL Validation", () => {
  describe("normalizeIP", () => {
    it("strips brackets from IPv6 literals", () => {
      expect(normalizeIP("[::1]")).toBe("::1");
      expect(normalizeIP("[fe80::1]")).toBe("fe80::1");
    });

    it("unwraps IPv4-mapped IPv6 addresses", () => {
      expect(normalizeIP("::ffff:127.0.0.1")).toBe("127.0.0.1");
      expect(normalizeIP("::ffff:192.168.1.10")).toBe("192.168.1.10");
      expect(normalizeIP("::ffff:23.195.12.1")).toBe("23.195.12.1");
    });
  });

  describe("isPrivateIP", () => {
    it("blocks IPv4 loopback addresses (127.0.0.0/8)", () => {
      expect(isPrivateIP("127.0.0.1")).toBe(true);
      expect(isPrivateIP("127.0.0.254")).toBe(true);
      expect(isPrivateIP("127.128.0.1")).toBe(true);
    });

    it("blocks IPv4 private RFC1918 ranges", () => {
      // 10.0.0.0/8
      expect(isPrivateIP("10.0.0.1")).toBe(true);
      expect(isPrivateIP("10.255.255.255")).toBe(true);
      // 172.16.0.0/12
      expect(isPrivateIP("172.16.0.1")).toBe(true);
      expect(isPrivateIP("172.31.255.255")).toBe(true);
      // 192.168.0.0/16
      expect(isPrivateIP("192.168.0.1")).toBe(true);
      expect(isPrivateIP("192.168.255.255")).toBe(true);
    });

    it("blocks Cloud metadata and link-local (169.254.0.0/16)", () => {
      expect(isPrivateIP("169.254.169.254")).toBe(true);
      expect(isPrivateIP("169.254.1.1")).toBe(true);
    });

    it("blocks Carrier-Grade NAT (100.64.0.0/10)", () => {
      expect(isPrivateIP("100.64.0.1")).toBe(true);
      expect(isPrivateIP("100.127.255.255")).toBe(true);
    });

    it("blocks 0.0.0.0/8 and Multicast/Reserved IPv4 (>= 224.0.0.0)", () => {
      expect(isPrivateIP("0.0.0.0")).toBe(true);
      expect(isPrivateIP("0.1.2.3")).toBe(true);
      expect(isPrivateIP("224.0.0.1")).toBe(true);
      expect(isPrivateIP("240.0.0.1")).toBe(true);
      expect(isPrivateIP("255.255.255.255")).toBe(true);
    });

    it("blocks IPv6 loopback, link-local, unique local, and multicast", () => {
      expect(isPrivateIP("::1")).toBe(true);
      expect(isPrivateIP("::")).toBe(true);
      expect(isPrivateIP("fc00::1")).toBe(true);
      expect(isPrivateIP("fd12:3456:789a::1")).toBe(true);
      expect(isPrivateIP("fe80::1")).toBe(true);
      expect(isPrivateIP("ff02::1")).toBe(true);
      expect(isPrivateIP("2001:db8::1")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 for private IPv4 destinations", () => {
      expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateIP("::ffff:10.0.0.1")).toBe(true);
      expect(isPrivateIP("::ffff:169.254.169.254")).toBe(true);
    });

    it("ALLOWS public IPv4 and IPv6 addresses without false positives", () => {
      expect(isPrivateIP("1.1.1.1")).toBe(false);
      expect(isPrivateIP("8.8.8.8")).toBe(false);
      expect(isPrivateIP("93.184.216.34")).toBe(false);
      // Ensure former false-positive 23.x.x.x (Akamai / public CDNs) is allowed:
      expect(isPrivateIP("23.195.12.1")).toBe(false);
      expect(isPrivateIP("22.1.2.3")).toBe(false);
      // Ensure boundaries outside private ranges are allowed:
      expect(isPrivateIP("172.32.0.1")).toBe(false);
      expect(isPrivateIP("172.15.255.255")).toBe(false);
      expect(isPrivateIP("100.128.0.1")).toBe(false);
      // IPv4-mapped public IP:
      expect(isPrivateIP("::ffff:23.195.12.1")).toBe(false);
    });
  });

  describe("isSafeUrl", () => {
    it("allows valid public URLs", () => {
      expect(isSafeUrl("http://example.com")).toBe(true);
      expect(isSafeUrl("https://api.github.com/users")).toBe(true);
      expect(isSafeUrl("https://23.195.12.1/image.png")).toBe(true);
    });

    it("rejects unsafe protocols", () => {
      expect(isSafeUrl("ftp://example.com")).toBe(false);
      expect(isSafeUrl("file:///etc/passwd")).toBe(false);
      expect(isSafeUrl("gopher://example.com")).toBe(false);
      expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects localhost and local domain patterns", () => {
      expect(isSafeUrl("http://localhost")).toBe(false);
      expect(isSafeUrl("http://localhost:8080")).toBe(false);
      expect(isSafeUrl("http://app.localhost")).toBe(false);
      expect(isSafeUrl("http://service.local")).toBe(false);
      expect(isSafeUrl("http://metadata.google.internal")).toBe(false);
    });

    it("rejects private IP literals", () => {
      expect(isSafeUrl("http://127.0.0.1")).toBe(false);
      expect(isSafeUrl("http://10.0.0.1/admin")).toBe(false);
      expect(isSafeUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
      expect(isSafeUrl("http://[::1]/secret")).toBe(false);
    });
  });

  describe("safeFetch integration", () => {
    it("blocks localhost (DNS resolves to loopback)", async () => {
      await expect(safeFetch("http://localhost:1/")).rejects.toThrow(
        /private|BLOCKED/i,
      );
    });

    it("blocks 127.0.0.1 directly", async () => {
      await expect(safeFetch("http://127.0.0.1:1/")).rejects.toThrow(
        /private|BLOCKED/i,
      );
    });

    it("blocks 169.254.169.254 (cloud metadata)", async () => {
      await expect(
        safeFetch("http://169.254.169.254/latest/meta-data"),
      ).rejects.toThrow(/private|BLOCKED/i);
    });

    it("blocks IPv6 loopback", async () => {
      await expect(safeFetch("http://[::1]:8080/")).rejects.toThrow();
    });

    it("blocks non-http(s) protocols", async () => {
      await expect(safeFetch("ftp://example.com")).rejects.toThrow(/protocol/i);
      await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(
        /protocol/i,
      );
    });

    it("enforces timeout on unreachable host", async () => {
      await expect(
        safeFetch("http://192.168.255.255:1/", { timeout: 500 }),
      ).rejects.toThrow(/timeout|private/i);
    });

    it("rejects localhost. (trailing-dot FQDN)", () => {
      expect(isSafeUrl("http://localhost.")).toBe(false);
    });
  });
});
