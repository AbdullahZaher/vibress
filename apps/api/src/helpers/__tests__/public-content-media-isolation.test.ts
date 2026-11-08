import { describe, expect, it, vi } from "vitest";
import { extractFeatureImage, resolveDocumentMedia } from "../public-content-helpers";
import { renderStudioDocumentToHtml } from "@vibress/studio-renderer";
import type { MediaService } from "@vibress/media";

describe("resolveDocumentMedia — cross-publication media isolation", () => {
  it("resolves media assets that belong to the specified publication", async () => {
    const mockMediaService = {
      getMediaById: vi.fn(async (id: string, publicationId?: string) => {
        if (id === "asset-pub-a" && publicationId === "pub_a") {
          return {
            id: "asset-pub-a",
            publicationId: "pub_a",
            width: 800,
            height: 600,
            displayName: "Pub A Safe Image",
          } as any;
        }
        throw new Error("Media not found in publication");
      }),
      getMediaUrl: vi.fn(async (asset: any) => `/content/media/pub_a/${asset.id}.jpg`),
    } as unknown as MediaService;

    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "studio-card",
            cardType: "image",
            cardData: {
              assetId: "asset-pub-a",
              alt: "",
            },
          },
        ],
      },
    };

    const resolved = await resolveDocumentMedia(doc, mockMediaService, "pub_a");
    const firstChild = (resolved.root as any).children[0];
    expect(firstChild.cardData.src).toBe("/content/media/pub_a/asset-pub-a.jpg");
    expect(firstChild.cardData.alt).toBe("Pub A Safe Image");
    expect(firstChild.cardData.width).toBe(800);
    expect(firstChild.cardData.height).toBe(600);
  });

  it("denies access to media belonging to a foreign publication without leaking metadata", async () => {
    const mockMediaService = {
      getMediaById: vi.fn(async (id: string, publicationId?: string) => {
        // Asset belongs to pub_b, but publicationId is pub_a
        if (publicationId === "pub_b" && id === "asset-pub-b") {
          return {
            id: "asset-pub-b",
            publicationId: "pub_b",
            displayName: "Private Secret Asset",
            width: 1200,
            height: 900,
          } as any;
        }
        throw new Error("Asset not found in publication");
      }),
      getMediaUrl: vi.fn(async (asset: any) => `/content/media/pub_b/${asset.id}.jpg`),
    } as unknown as MediaService;

    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "studio-card",
            cardType: "image",
            cardData: {
              assetId: "asset-pub-b",
              alt: "",
            },
          },
        ],
      },
    };

    // pub_a tries to resolve asset-pub-b
    const resolved = await resolveDocumentMedia(doc, mockMediaService, "pub_a");
    const firstChild = (resolved.root as any).children[0];

    // Must NOT leak pub_b's media url, dimensions or alt text
    expect(firstChild.cardData.src).toBeUndefined();
    expect(firstChild.cardData.alt).toBeUndefined();
    expect(firstChild.cardData.width).toBeUndefined();
    expect(firstChild.cardData.height).toBeUndefined();

    // Verify mock was invoked with pub_a scope
    expect(mockMediaService.getMediaById).toHaveBeenCalledWith("asset-pub-b", "pub_a");
  });

  it("enforces publication boundaries across gallery images", async () => {
    const mockMediaService = {
      getMediaById: vi.fn(async (id: string, publicationId?: string) => {
        if (id === "pub-a-img" && publicationId === "pub_a") {
          return {
            id: "pub-a-img",
            publicationId: "pub_a",
            width: 400,
            height: 300,
            displayName: "Pub A Gallery Item",
          } as any;
        }
        throw new Error("Asset not found in publication");
      }),
      getMediaUrl: vi.fn(async (asset: any) => `/content/media/pub_a/${asset.id}.jpg`),
    } as unknown as MediaService;

    const doc = {
      root: {
        type: "root",
        children: [
          {
            type: "studio-card",
            cardType: "gallery",
            cardData: {
              images: [
                { assetId: "pub-a-img", alt: "" },
                { assetId: "pub-b-foreign-img", alt: "" },
              ],
            },
          },
        ],
      },
    };

    const resolved = await resolveDocumentMedia(doc, mockMediaService, "pub_a");
    const galleryCard = (resolved.root as any).children[0];
    const images = galleryCard.cardData.images;

    // First image (belonging to pub_a) is resolved
    expect(images[0].src).toBe("/content/media/pub_a/pub-a-img.jpg");
    expect(images[0].alt).toBe("Pub A Gallery Item");

    // Second image (foreign to pub_a) remains unresolved and unleaked
    expect(images).toHaveLength(1); // rejected image is absent from public JSON
  });
  it("fails closed for a pre-populated foreign singular image in JSON, HTML, and feature metadata", async () => {
    const service = {
      getMediaById: vi.fn(async () => { throw new Error("foreign publication"); }),
      getMediaUrl: vi.fn(async () => "/content/media/pub_b/forbidden.jpg"),
    } as unknown as MediaService;
    const doc = {
      root: { type: "root", children: [{
        type: "studio-card", cardType: "image", version: 1,
        cardData: {
          assetId: "pub_b-secret-asset",
          src: "/content/media/pub_b/private-image.jpg",
          alt: "FOREIGN PRIVATE ALT",
          width: 1536,
          height: 1024,
          caption: "FOREIGN PRIVATE CAPTION",
        },
      }] },
    };
    const original = JSON.stringify(doc);
    const projected = await resolveDocumentMedia(doc, service, "pub_a");
    const card = (projected.root as { children: Array<{ cardData: unknown }> }).children[0];
    expect(card?.cardData).toEqual({});
    const json = JSON.stringify(projected);
    const html = renderStudioDocumentToHtml(projected);
    for (const privateValue of ["pub_b-secret-asset", "pub_b/private-image.jpg", "FOREIGN PRIVATE ALT", "FOREIGN PRIVATE CAPTION", "1536", "1024"]) {
      expect(json).not.toContain(privateValue);
      expect(html).not.toContain(privateValue);
    }
    expect(extractFeatureImage(projected)).toBeNull();
    expect(JSON.stringify(doc)).toBe(original); // stored content is never mutated
  });

  it("discards foreign gallery items while preserving authorized and external images", async () => {
    const service = {
      getMediaById: vi.fn(async (id: string, publicationId: string) => {
        if (id === "owned" && publicationId === "pub_a") {
          return {
            id, publicationId, width: 640, height: 480, displayName: "Owned image",
          };
        }
        throw new Error("foreign publication");
      }),
      getMediaUrl: vi.fn(async () => "/content/media/pub_a/owned.jpg"),
    } as unknown as MediaService;
    const doc = {
      root: { type: "root", children: [{
        type: "studio-card", cardType: "gallery", version: 1,
        cardData: {
          caption: "Publication A gallery",
          images: [
            { assetId: "owned", src: "/outdated.jpg", alt: "" },
            { assetId: "foreign", src: "https://foreign.example/private.jpg", alt: "FOREIGN ALT", width: 9999, height: 8888 },
            { src: "https://images.unsplash.com/photo-allowed", alt: "External image" },
          ],
        },
      }] },
    };
    const original = JSON.stringify(doc);
    const projected = await resolveDocumentMedia(doc, service, "pub_a");
    const json = JSON.stringify(projected);
    const html = renderStudioDocumentToHtml(projected);
    const card = (projected.root as {
      children: Array<{ cardData: { images: Array<{ src: string }> } }>
    }).children[0];
    expect(card?.cardData.images).toHaveLength(2);
    expect(card?.cardData.images[0]?.src).toBe("/content/media/pub_a/owned.jpg");
    expect(card?.cardData.images[1]?.src).toBe("https://images.unsplash.com/photo-allowed");
    for (const marker of ["foreign.example", "FOREIGN ALT", "9999", "8888", "\"assetId\":\"foreign\""]) {
      expect(json).not.toContain(marker);
      expect(html).not.toContain(marker);
    }
    expect(html).toContain("/content/media/pub_a/owned.jpg");
    expect(html).toContain("images.unsplash.com/photo-allowed");
    expect(JSON.stringify(doc)).toBe(original);
  });

  it("rejects a foreign asset even if a media repository ignores the requested publication", async () => {
    const getMediaUrl = vi.fn(async () => "https://foreign.example/file.jpg");
    const service = {
      getMediaById: vi.fn(async () => ({
        id: "foreign", publicationId: "pub_b", displayName: "SECRET",
      })),
      getMediaUrl,
    } as unknown as MediaService;
    const projected = await resolveDocumentMedia({
      root: { type: "root", children: [{
        type: "studio-card", cardType: "image", cardData: {
          assetId: "foreign", src: "https://foreign.example/stale.jpg",
        },
      }] },
    }, service, "pub_a");
    expect(JSON.stringify(projected)).not.toContain("foreign.example");
    expect(getMediaUrl).not.toHaveBeenCalled();
  });

  it("fails closed if the scoped asset URL is unavailable, not only if lookup throws", async () => {
    const service = {
      getMediaById: vi.fn(async () => ({
        id: "owned", publicationId: "pub_a", displayName: "Owned",
      })),
      getMediaUrl: vi.fn(async () => null),
    } as unknown as MediaService;
    const projected = await resolveDocumentMedia({
      root: { type: "root", children: [{
        type: "studio-card", cardType: "image", cardData: {
          assetId: "owned", src: "/content/media/stale.jpg", alt: "STALE ALT",
        },
      }] },
    }, service, "pub_a");
    expect(JSON.stringify(projected)).not.toContain("stale.jpg");
    expect(JSON.stringify(projected)).not.toContain("STALE ALT");
  });

  it("requires publication scope rather than silently using unscoped media lookup", async () => {
    const getMediaById = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const service = { getMediaById } as unknown as MediaService;
    await expect(resolveDocumentMedia({ root: { type: "root", children: [] } }, service, ""))
      .rejects.toThrow("publication ID");
    expect(getMediaById).not.toHaveBeenCalled();
  });

  it("continues supporting external image media without a catalog asset ID", async () => {
    const getMediaById = vi.fn(async () => { throw new Error("not needed"); });
    const service = { getMediaById } as unknown as MediaService;
    const projected = await resolveDocumentMedia({
      root: { type: "root", children: [{
        type: "studio-card", cardType: "image", version: 1,
        cardData: { src: "https://images.unsplash.com/photo-safe", alt: "Allowed" },
      }] },
    }, service, "pub_a");
    expect(renderStudioDocumentToHtml(projected)).toContain("images.unsplash.com/photo-safe");
    expect(getMediaById).not.toHaveBeenCalled();
  });

});
