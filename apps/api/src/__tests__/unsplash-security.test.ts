import { describe, expect, it } from "vitest";
import {
  isAllowedUnsplashApiUrl,
  isAllowedUnsplashHost,
} from "../routes/integrations-unsplash";

describe("Unsplash outbound URL policy", () => {
  it("allows only the intended HTTPS API origin for credentialed calls", () => {
    expect(isAllowedUnsplashApiUrl("https://api.unsplash.com/photos/abc/download")).toBe(true);
    for (const url of [
      "http://api.unsplash.com/photos/abc",
      "https://api.unsplash.com.evil.example/photos/abc",
      "https://api.unsplash.com:8443/photos/abc",
      "https://user:secret@api.unsplash.com/photos/abc",
      "https://127.0.0.1/photos/abc",
      "file:///etc/passwd",
    ]) {
      expect(isAllowedUnsplashApiUrl(url)).toBe(false);
    }
  });

  it("does not accept attacker-controlled image-host subdomains or lookalikes", () => {
    for (const allowed of ["images.unsplash.com", "plus.unsplash.com", "api.unsplash.com"]) {
      expect(isAllowedUnsplashHost(allowed)).toBe(true);
    }
    for (const denied of ["images.unsplash.com.evil.example", "127.0.0.1", "example.com"]) {
      expect(isAllowedUnsplashHost(denied)).toBe(false);
    }
  });
});
