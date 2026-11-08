import { describe, expect, it, vi } from "vitest";
import { resolveDocumentMedia } from "../public-content-helpers";
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
    expect(firstChild.cardData.alt).toBe("");
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
    expect(images[1].src).toBeUndefined();
    expect(images[1].alt).toBe("");
  });
});
