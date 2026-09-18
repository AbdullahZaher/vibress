import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getConfig } from "@vibress/config";
import { getRedisClient } from "@vibress/cache";
import { mediaService } from "../services";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import { errorMessage } from "../helpers/errors";

const SelectPhotoInputSchema = z.object({
  photoId: z.string().min(1).max(100),
});

const UNSPLASH_API_BASE = "https://api.unsplash.com";
const MAX_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20MB

function getUnsplashAccessKey(): string | null {
  try {
    const config = getConfig();
    return config.unsplash.accessKey || process.env.UNSPLASH_ACCESS_KEY || null;
  } catch {
    return process.env.UNSPLASH_ACCESS_KEY || null;
  }
}

function isAllowedUnsplashHost(hostname: string): boolean {
  const allowed = [
    "unsplash.com",
    "images.unsplash.com",
    "plus.unsplash.com",
    "api.unsplash.com",
  ];
  const h = hostname.toLowerCase();
  return allowed.includes(h) || h.endsWith(".unsplash.com");
}

function isPrivateIp(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return true;
  }
  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const p0 = parts[0];
    const p1 = parts[1];
    if (p0 === 10) return true;
    if (p0 === 172 && p1 !== undefined && p1 >= 16 && p1 <= 31) return true;
    if (p0 === 192 && p1 === 168) return true;
    if (p0 === 169 && p1 === 254) return true;
    if (p0 === 127) return true;
  }
  return false;
}

export async function unsplashRoutes(fastify: FastifyInstance) {
  // Status check
  fastify.get("/status", {
    preHandler: [requireStaffSession, requirePermission("posts.read")],
    handler: async (_req, reply) => {
      const key = getUnsplashAccessKey();
      return reply.status(200).send({
        configured: Boolean(key && key.trim().length > 0),
      });
    },
  });

  // Search photos
  fastify.get("/search", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const key = getUnsplashAccessKey();
      if (!key) {
        return reply.status(400).send({
          errors: [
            {
              code: "UNSPLASH_NOT_CONFIGURED",
              message: "Unsplash access key is not configured",
              requestId: req.id,
            },
          ],
        });
      }

      const queryParams = (req.query ?? {}) as {
        query?: string;
        page?: string;
        perPage?: string;
      };

      const query = (queryParams.query || "").trim();
      if (!query) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Search query is required",
              requestId: req.id,
            },
          ],
        });
      }

      const page = Math.max(1, Math.min(parseInt(queryParams.page || "1", 10) || 1, 100));
      const perPage = Math.max(1, Math.min(parseInt(queryParams.perPage || "20", 10) || 20, 30));

      const cacheKey = `unsplash:search:${Buffer.from(`${query}:${page}:${perPage}`).toString("base64")}`;

      try {
        const redis = getRedisClient();
        const cached = await redis.get(cacheKey);
        if (cached) {
          return reply.status(200).send(JSON.parse(cached));
        }
      } catch {
        // Cache miss or Redis unavailable
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const url = new URL(`${UNSPLASH_API_BASE}/search/photos`);
        url.searchParams.set("query", query);
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(perPage));

        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Client-ID ${key}`,
            "Accept-Version": "v1",
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const status = res.status;
          req.log.warn({ status, query }, "Unsplash search returned error status");
          if (status === 403) {
            return reply.status(429).send({
              errors: [
                {
                  code: "UNSPLASH_RATE_LIMIT",
                  message: "Unsplash API rate limit exceeded or access key invalid",
                  requestId: req.id,
                },
              ],
            });
          }
          return reply.status(502).send({
            errors: [
              {
                code: "UNSPLASH_UPSTREAM_ERROR",
                message: `Unsplash API responded with status ${status}`,
                requestId: req.id,
              },
            ],
          });
        }

        const data = (await res.json()) as any;
        const results = (data.results || []).map((p: any) => ({
          id: p.id,
          width: p.width,
          height: p.height,
          color: p.color || "#000000",
          blurHash: p.blur_hash || null,
          description: p.description || p.alt_description || "Photo on Unsplash",
          altDescription: p.alt_description || null,
          urls: {
            raw: p.urls?.raw,
            full: p.urls?.full,
            regular: p.urls?.regular,
            small: p.urls?.small,
            thumb: p.urls?.thumb,
          },
          links: {
            html: `${p.links?.html || ""}?utm_source=vibress&utm_medium=referral`,
            downloadLocation: p.links?.download_location,
          },
          user: {
            id: p.user?.id,
            username: p.user?.username,
            name: p.user?.name,
            portfolioUrl: p.user?.portfolio_url || null,
            profileUrl: `${p.user?.links?.html || ""}?utm_source=vibress&utm_medium=referral`,
            profileImage: p.user?.profile_image?.medium || p.user?.profile_image?.small || null,
          },
        }));

        const responsePayload = {
          results,
          total: data.total || 0,
          totalPages: data.total_pages || 0,
          page,
          perPage,
        };

        try {
          const redis = getRedisClient();
          await redis.set(cacheKey, JSON.stringify(responsePayload), "EX", 300);
        } catch {
          // Ignore cache set failure
        }

        return reply.status(200).send(responsePayload);
      } catch (err: any) {
        clearTimeout(timeout);
        req.log.error({ err: errorMessage(err) }, "Unsplash search request failed");
        return reply.status(504).send({
          errors: [
            {
              code: "UNSPLASH_TIMEOUT",
              message: "Unsplash request timed out or failed to connect",
              requestId: req.id,
            },
          ],
        });
      }
    },
  });

  // Select photo by canonical photoId, trigger download tracking, and import into media library
  fastify.post("/select", {
    preHandler: [
      requireStaffSession,
      requirePermission("posts.edit"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const key = getUnsplashAccessKey();
      if (!key) {
        return reply.status(400).send({
          errors: [
            {
              code: "UNSPLASH_NOT_CONFIGURED",
              message: "Unsplash access key is not configured",
              requestId: req.id,
            },
          ],
        });
      }

      const parseResult = SelectPhotoInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Valid photoId is required",
              requestId: req.id,
            },
          ],
        });
      }

      const { photoId } = parseResult.data;

      // 1. Fetch canonical photo metadata directly from Unsplash
      const metaController = new AbortController();
      const metaTimeout = setTimeout(() => metaController.abort(), 10000);

      let photo: any;
      try {
        const photoRes = await fetch(
          `${UNSPLASH_API_BASE}/photos/${encodeURIComponent(photoId)}`,
          {
            headers: {
              Authorization: `Client-ID ${key}`,
              "Accept-Version": "v1",
            },
            signal: metaController.signal,
          },
        );
        clearTimeout(metaTimeout);

        if (photoRes.status === 404) {
          return reply.status(404).send({
            errors: [
              {
                code: "UNSPLASH_PHOTO_NOT_FOUND",
                message: "Photo not found on Unsplash",
                requestId: req.id,
              },
            ],
          });
        }
        if (!photoRes.ok) {
          return reply.status(502).send({
            errors: [
              {
                code: "UNSPLASH_UPSTREAM_ERROR",
                message: `Failed to fetch photo from Unsplash: status ${photoRes.status}`,
                requestId: req.id,
              },
            ],
          });
        }
        photo = await photoRes.json();
      } catch {
        clearTimeout(metaTimeout);
        return reply.status(504).send({
          errors: [
            {
              code: "UNSPLASH_TIMEOUT",
              message: "Timeout contacting Unsplash API",
              requestId: req.id,
            },
          ],
        });
      }

      // 2. Trigger canonical download endpoint per Unsplash API terms
      let downloadUrl = photo.urls?.regular || photo.urls?.full;
      if (photo.links?.download_location) {
        try {
          const dlRes = await fetch(photo.links.download_location, {
            headers: {
              Authorization: `Client-ID ${key}`,
              "Accept-Version": "v1",
            },
          });
          if (dlRes.ok) {
            const dlData = (await dlRes.json()) as any;
            if (dlData.url) {
              downloadUrl = dlData.url;
            }
          }
        } catch (dlErr) {
          req.log.warn({ err: errorMessage(dlErr) }, "Failed to trigger Unsplash download endpoint");
        }
      }

      // 3. Validate downloadUrl against SSRF
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(downloadUrl);
      } catch {
        return reply.status(502).send({
          errors: [
            {
              code: "INVALID_DOWNLOAD_URL",
              message: "Invalid image URL returned by provider",
              requestId: req.id,
            },
          ],
        });
      }

      if (parsedUrl.protocol !== "https:") {
        return reply.status(400).send({
          errors: [
            {
              code: "INSECURE_DOWNLOAD_URL",
              message: "Provider URL must use HTTPS",
              requestId: req.id,
            },
          ],
        });
      }

      if (!isAllowedUnsplashHost(parsedUrl.hostname) || isPrivateIp(parsedUrl.hostname)) {
        return reply.status(400).send({
          errors: [
            {
              code: "UNAUTHORIZED_HOST",
              message: "Host is not an authorized Unsplash asset host",
              requestId: req.id,
            },
          ],
        });
      }

      // 4. Download binary stream with size limit
      const dlController = new AbortController();
      const dlTimeout = setTimeout(() => dlController.abort(), 15000);

      let imageBuffer: Buffer;
      let detectedMime = "image/jpeg";
      try {
        const imgRes = await fetch(downloadUrl, {
          signal: dlController.signal,
        });
        clearTimeout(dlTimeout);

        if (!imgRes.ok) {
          return reply.status(502).send({
            errors: [
              {
                code: "IMAGE_DOWNLOAD_FAILED",
                message: `Failed to download image: status ${imgRes.status}`,
                requestId: req.id,
              },
            ],
          });
        }

        const contentType = imgRes.headers.get("content-type");
        if (contentType) {
          const mimePart = contentType.split(";")[0];
          if (mimePart) detectedMime = mimePart.trim();
        }

        const arrayBuffer = await imgRes.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
          return reply.status(400).send({
            errors: [
              {
                code: "IMAGE_TOO_LARGE",
                message: "Downloaded image exceeds 20MB limit",
                requestId: req.id,
              },
            ],
          });
        }
        imageBuffer = Buffer.from(arrayBuffer);
      } catch {
        clearTimeout(dlTimeout);
        return reply.status(504).send({
          errors: [
            {
              code: "DOWNLOAD_TIMEOUT",
              message: "Timeout downloading image asset",
              requestId: req.id,
            },
          ],
        });
      }

      // 5. Upload via Vibress MediaService (which executes full magic-bytes, limits, and storage upload)
      const publicationId = req.publicationContext?.publicationId || "pub_default";
      const mediaAsset = await mediaService.uploadMedia(
        {
          publicationId,
          filename: `unsplash-${photo.id}.jpg`,
          mimeType: detectedMime,
          buffer: imageBuffer,
          displayName: `Photo by ${photo.user?.name || "Unknown"} on Unsplash`,
          uploadedBy: req.user!.id,
          assetType: "image",
        },
        req.user!.id,
        publicationId,
      );

      // 6. Update metadata with rich Unsplash attribution
      const photographerName = photo.user?.name || "Photographer";
      const photographerUrl = `${photo.user?.links?.html || ""}?utm_source=vibress&utm_medium=referral`;
      const photoPageUrl = `${photo.links?.html || ""}?utm_source=vibress&utm_medium=referral`;
      const description = photo.description || photo.alt_description || "";
      const altText = photo.alt_description || photo.description || `Photo by ${photographerName} on Unsplash`;
      const caption = `Photo by [${photographerName}](${photographerUrl}) on [Unsplash](${photoPageUrl})`;

      const updatedAsset = await mediaService.updateMediaMetadata(
        mediaAsset.id,
        {
          displayName: `Photo by ${photographerName} on Unsplash`,
          metadata: {
            provider: "unsplash",
            unsplash: {
              photoId: photo.id,
              photoUrl: photoPageUrl,
              photographerName,
              photographerUsername: photo.user?.username,
              photographerUrl,
              downloadLocation: photo.links?.download_location,
              description,
              altDescription: photo.alt_description || null,
              blurHash: photo.blur_hash || null,
              width: photo.width,
              height: photo.height,
              color: photo.color,
              urls: {
                raw: photo.urls?.raw,
                full: photo.urls?.full,
                regular: photo.urls?.regular,
                small: photo.urls?.small,
                thumb: photo.urls?.thumb,
              },
            },
          },
        },
        req.user!.id,
        publicationId,
      );

      const internalUrl = await mediaService.getMediaUrl(updatedAsset);
      const url = photo.urls?.regular || internalUrl;

      return reply.status(201).send({
        media: {
          id: updatedAsset.id,
          url,
          width: photo.width,
          height: photo.height,
          altText,
          caption,
          attribution: {
            photographerName,
            photographerUrl,
            photoUrl: photoPageUrl,
          },
          metadata: updatedAsset.metadata,
        },
      });
    },
  });
}
