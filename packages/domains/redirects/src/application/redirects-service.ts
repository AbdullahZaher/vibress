import {
  RedirectRepository,
  Redirect,
  CreateRedirectData,
} from "../domain/redirect";
import { domainEvents } from "@vibress/events";

export class RedirectDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Critical routes that redirect rules must never hijack.
 */
export const PROTECTED_ROUTE_PREFIXES = [
  "/api",
  "/admin",
  "/portal",
  "/health",
  "/content",
  "/assets",
];

/**
 * Redirect codes allowed: only documented safe HTTP redirect codes.
 */
export const ALLOWED_REDIRECT_CODES = [301, 302, 307, 308];

export const MAX_REDIRECT_CHAIN = 10;

export class RedirectsService {
  constructor(private repo: RedirectRepository) {}

  async createRedirect(
    data: CreateRedirectData,
    actorId: string | null,
    publicationId = "pub_default",
  ): Promise<Redirect> {
    this.validateSource(data.source);
    this.validateDestination(data.destination);
    if (
      data.statusCode !== undefined &&
      !ALLOWED_REDIRECT_CODES.includes(data.statusCode)
    ) {
      throw new RedirectDomainError(
        "INVALID_STATUS_CODE",
        "Only 301, 302, 307, and 308 are allowed",
      );
    }
    const existing = await this.repo.findBySource(data.source, publicationId);
    if (existing)
      throw new RedirectDomainError(
        "SOURCE_EXISTS",
        "A redirect with this source already exists",
      );

    const redirect = await this.repo.create(data, publicationId);
    domainEvents.emit("redirect.created", { redirectId: redirect.id, actorId, publicationId });
    return redirect;
  }

  async updateRedirect(
    id: string,
    data: Partial<CreateRedirectData>,
    actorId: string | null,
    publicationId = "pub_default",
  ): Promise<Redirect> {
    const existing = await this.repo.findById(id, publicationId);
    if (!existing)
      throw new RedirectDomainError("REDIRECT_NOT_FOUND", "Redirect not found");
    if (data.source !== undefined) this.validateSource(data.source);
    if (data.destination !== undefined)
      this.validateDestination(data.destination);
    if (
      data.statusCode !== undefined &&
      !ALLOWED_REDIRECT_CODES.includes(data.statusCode)
    ) {
      throw new RedirectDomainError(
        "INVALID_STATUS_CODE",
        "Only 301, 302, 307, and 308 are allowed",
      );
    }
    if (data.source && data.source !== existing.source && await this.repo.findBySource(data.source, publicationId)) {
      throw new RedirectDomainError("SOURCE_EXISTS", "A redirect with this source already exists");
    }
    const updated = await this.repo.update(id, data, publicationId);
    domainEvents.emit("redirect.updated", { redirectId: id, actorId, publicationId });
    return updated;
  }

  async deleteRedirect(id: string, actorId: string | null, publicationId = "pub_default"): Promise<void> {
    // Preserve idempotent DELETE semantics while enforcing tenant scope.
    await this.repo.delete(id, publicationId);
    domainEvents.emit("redirect.deleted", { redirectId: id, actorId, publicationId });
  }

  async listRedirects(publicationId = "pub_default"): Promise<Redirect[]> {
    return this.repo.list(publicationId);
  }

  /**
   * Resolves a path through enabled redirects with loop protection.
   * Returns the final destination or null. Follows a bounded chain.
   */
  async resolve(
    path: string,
    publicationId = "pub_default",
  ): Promise<{ destination: string; statusCode: number } | null> {
    const redirects = await this.repo.listEnabled(publicationId);
    const map = new Map(redirects.map((r) => [r.source, r]));
    let current = path;
    const seen = new Set<string>();
    let hops = 0;

    while (hops < MAX_REDIRECT_CHAIN) {
      if (seen.has(current)) break; // loop
      seen.add(current);
      const rule = map.get(current);
      if (!rule) break;
      current = rule.destination;
      hops++;
      if (!map.has(current)) {
        return { destination: current, statusCode: rule.statusCode };
      }
    }
    return null;
  }

  private validateSource(source: string): void {
    if (!source || !source.startsWith("/") || source.startsWith("//")) {
      throw new RedirectDomainError(
        "INVALID_SOURCE",
        "Source must be a relative path starting with /",
      );
    }
    if (source.length > 500)
      throw new RedirectDomainError("INVALID_SOURCE", "Source is too long");
    for (const prefix of PROTECTED_ROUTE_PREFIXES) {
      if (source.startsWith(prefix)) {
        throw new RedirectDomainError(
          "PROTECTED_ROUTE",
          `Cannot redirect protected route prefix: ${prefix}`,
        );
      }
    }
  }

  private validateDestination(destination: string): void {
    if (!destination || destination.length > 2000) {
      throw new RedirectDomainError(
        "INVALID_DESTINATION",
        "Invalid destination",
      );
    }
    if (
      destination.startsWith("http://") ||
      destination.startsWith("https://")
    ) {
      // External redirect: validated (http/https only)
      try {
        const url = new URL(destination);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new RedirectDomainError(
            "INVALID_DESTINATION",
            "Only http/https destinations are allowed",
          );
        }
      } catch {
        throw new RedirectDomainError(
          "INVALID_DESTINATION",
          "Invalid destination URL",
        );
      }
      return;
    }
    // Internal destination: relative path. WHATWG URL parsing treats backslashes
    // like slashes for special schemes, which could turn /\\evil into an
    // unexpected external host.
    if (!destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\")) {
      throw new RedirectDomainError(
        "INVALID_DESTINATION",
        "Internal destinations must start with /",
      );
    }
    if (
      destination.startsWith("javascript:") ||
      destination.startsWith("data:")
    ) {
      throw new RedirectDomainError(
        "INVALID_DESTINATION",
        "Unsafe destination scheme",
      );
    }
  }
}
