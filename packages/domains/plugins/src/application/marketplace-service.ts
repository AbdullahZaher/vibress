import {
  type PluginCatalogEntry,
  type PluginPublisher,
  type PluginSecurityAdvisory,
  checkPluginAdmissibility,
  filterCatalogEntries,
} from "./plugin-catalog.js";

export type PublisherStatus = "pending" | "verified" | "suspended";

export interface ManagedPublisher extends PluginPublisher {
  readonly status: PublisherStatus;
  readonly contactEmail: string;
  readonly registeredAt: string;
  readonly verifiedAt?: string | undefined;
  readonly suspendedAt?: string | undefined;
  readonly suspensionReason?: string | undefined;
}

export interface MarketplacePluginListing extends PluginCatalogEntry {
  readonly downloadsCount: number;
  readonly rating: number;
  readonly featured: boolean;
  readonly publishedAt: string;
}

export interface MarketplaceInstallRequest {
  readonly pluginId: string;
  readonly releaseDigest: string;
  readonly publicationId: string;
  readonly operatorId: string;
  readonly requireTier2Isolation: boolean;
}

export class MarketplaceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MarketplaceError";
  }
}

export class MarketplaceService {
  private readonly publishers = new Map<string, ManagedPublisher>();
  private readonly listings = new Map<string, MarketplacePluginListing>();
  private readonly securityAdvisories = new Map<string, PluginSecurityAdvisory[]>();

  constructor(initialData?: {
    publishers?: ManagedPublisher[];
    listings?: MarketplacePluginListing[];
  }) {
    if (initialData?.publishers) {
      for (const p of initialData.publishers) {
        this.publishers.set(p.id, p);
      }
    }
    if (initialData?.listings) {
      for (const l of initialData.listings) {
        this.listings.set(l.id, l);
      }
    }
  }

  // --- Publisher Management (MKT-01) ---

  registerPublisher(input: {
    id: string;
    name: string;
    contactEmail: string;
    url?: string | undefined;
  }): ManagedPublisher {
    if (this.publishers.has(input.id)) {
      throw new MarketplaceError("PUBLISHER_EXISTS", `Publisher '${input.id}' is already registered`);
    }

    const publisher: ManagedPublisher = {
      id: input.id,
      name: input.name,
      contactEmail: input.contactEmail,
      url: input.url,
      verified: false,
      status: "pending",
      registeredAt: new Date().toISOString(),
    };

    this.publishers.set(input.id, publisher);
    return publisher;
  }

  verifyPublisher(publisherId: string): ManagedPublisher {
    const publisher = this.publishers.get(publisherId);
    if (!publisher) {
      throw new MarketplaceError("PUBLISHER_NOT_FOUND", `Publisher '${publisherId}' not found`);
    }

    const updated: ManagedPublisher = {
      ...publisher,
      verified: true,
      status: "verified",
      verifiedAt: new Date().toISOString(),
    };
    this.publishers.set(publisherId, updated);
    return updated;
  }

  suspendPublisher(publisherId: string, reason: string): ManagedPublisher {
    const publisher = this.publishers.get(publisherId);
    if (!publisher) {
      throw new MarketplaceError("PUBLISHER_NOT_FOUND", `Publisher '${publisherId}' not found`);
    }

    const updated: ManagedPublisher = {
      ...publisher,
      status: "suspended",
      suspendedAt: new Date().toISOString(),
      suspensionReason: reason,
    };
    this.publishers.set(publisherId, updated);

    // Automatically revoke all active listings by this publisher
    for (const [id, listing] of this.listings.entries()) {
      if (listing.publisher.id === publisherId) {
        this.listings.set(id, {
          ...listing,
          isRevoked: true,
          revocationReason: `Publisher suspended: ${reason}`,
        });
      }
    }

    return updated;
  }

  getPublisher(publisherId: string): ManagedPublisher | null {
    return this.publishers.get(publisherId) ?? null;
  }

  // --- Marketplace Catalog & Discovery (MKT-02) ---

  addOrUpdateListing(listing: MarketplacePluginListing): void {
    const publisher = this.publishers.get(listing.publisher.id);
    if (publisher && publisher.status === "suspended") {
      throw new MarketplaceError("PUBLISHER_SUSPENDED", `Cannot list plugins for suspended publisher '${publisher.id}'`);
    }
    this.listings.set(listing.id, listing);
  }

  searchListings(options: {
    query?: string | undefined;
    trustTier?: "curated_operator" | "community_reviewed" | "untrusted_marketplace" | undefined;
    capability?: string | undefined;
    currentApiVersion?: string | undefined;
  }): readonly MarketplacePluginListing[] {
    const all = Array.from(this.listings.values());
    const filtered = filterCatalogEntries(all, options);
    return filtered as MarketplacePluginListing[];
  }

  // --- Security Advisories & Revocations (MKT-03) ---

  publishSecurityAdvisory(pluginId: string, advisory: PluginSecurityAdvisory): void {
    const list = this.securityAdvisories.get(pluginId) || [];
    list.push(advisory);
    this.securityAdvisories.set(pluginId, list);

    // If critical advisory, revoke matching listing immediately
    if (advisory.severity === "critical") {
      const listing = this.listings.get(pluginId);
      if (listing) {
        this.listings.set(pluginId, {
          ...listing,
          isRevoked: true,
          revocationReason: `Critical security advisory ${advisory.id}: ${advisory.summary}`,
          securityAdvisories: [...(listing.securityAdvisories || []), advisory],
        });
      }
    }
  }

  emergencyRevoke(pluginId: string, reason: string): void {
    const listing = this.listings.get(pluginId);
    if (!listing) {
      throw new MarketplaceError("LISTING_NOT_FOUND", `Marketplace listing '${pluginId}' not found`);
    }

    this.listings.set(pluginId, {
      ...listing,
      isRevoked: true,
      revocationReason: reason,
    });
  }

  // --- Installation & Runtime Gate Check (MKT-04) ---

  authorizeMarketplaceInstall(
    request: MarketplaceInstallRequest,
    currentApiVersion: string,
  ): { authorized: boolean; reason?: string | undefined } {
    const listing = this.listings.get(request.pluginId);
    if (!listing) {
      return { authorized: false, reason: `Listing '${request.pluginId}' does not exist` };
    }

    if (listing.releaseDigest !== request.releaseDigest) {
      return { authorized: false, reason: "Requested release digest does not match published catalog digest" };
    }

    // Admissibility checks
    const admissibility = checkPluginAdmissibility(listing, currentApiVersion, {
      allowUntrustedMarketplace: request.requireTier2Isolation,
    });

    if (!admissibility.admissible) {
      return { authorized: false, reason: admissibility.reason };
    }

    // Security Gate: Untrusted plugins REQUIRE Tier 2 isolation
    if (listing.trustTier === "untrusted_marketplace" && !request.requireTier2Isolation) {
      return {
        authorized: false,
        reason: "Untrusted marketplace plugins cannot be installed into in-process host runtime. Tier 2 process isolation is required.",
      };
    }

    return { authorized: true };
  }
}
