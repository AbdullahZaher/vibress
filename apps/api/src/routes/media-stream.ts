import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { resolveCanonicalStorageRoot } from "@vibress/storage-core";
import { getConfig } from "@vibress/config";
import { settingsService, workspaceService } from "../services";
import {
  SITE_AUTH_COOKIE_NAME,
  verifySiteAuthToken,
} from "@vibress/security";

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogv":
      return "video/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

const INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "application/pdf",
]);

export function getContentDisposition(mimeType: string, filePath: string): string {
  const filename = path.basename(filePath);
  const disposition = INLINE_TYPES.has(mimeType) ? "inline" : "attachment";
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");
  const encodedFilename = encodeURIComponent(filename);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

function parseRangeHeader(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number } | "invalid" | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const rangeStr = rangeHeader.slice(6).trim();
  const dashIdx = rangeStr.indexOf("-");
  if (dashIdx === -1) return "invalid";

  const startStr = rangeStr.slice(0, dashIdx).trim();
  const endStr = rangeStr.slice(dashIdx + 1).trim();

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    const suffix = parseInt(endStr, 10);
    if (isNaN(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr === "") {
    start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0 || start >= fileSize) return "invalid";
    end = fileSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (
      isNaN(start) ||
      isNaN(end) ||
      start < 0 ||
      start > end ||
      start >= fileSize
    )
      return "invalid";
    end = Math.min(end, fileSize - 1);
  } else {
    return "invalid";
  }

  return { start, end };
}

function getSitePrivacySecret(): string {
  const config = getConfig();
  return (
    config.secrets.encryptionKey ||
    process.env.VIBRESS_ENCRYPTION_KEY ||
    "vibress-site-privacy-secret"
  );
}

async function requirePublicMediaAccess(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const host = request.hostname || (request.headers.host as string | undefined) || null;
  const isDevFallbackAllowed =
    !getConfig().isProduction && request.headers["x-dev-fallback"] !== "false";

  let publicationId: string;
  try {
    const pubCtx = await workspaceService.resolvePublicPublicationContext({
      host,
      isDevFallbackAllowed,
    });
    publicationId = pubCtx.publicationId;
    request.publicationContext = {
      publicationId: pubCtx.publicationId,
      workspaceId: pubCtx.workspaceId,
      actorType: pubCtx.actorType,
      isSystemOperation: pubCtx.isSystemOperation,
    };
  } catch {
    return reply.status(404).send({
      errors: [
        {
          code: "PUBLICATION_NOT_FOUND",
          message: "Publication not found",
          requestId: request.id,
        },
      ],
    });
  }

  let isPrivate: boolean;
  try {
    const publicSettings = await settingsService.getPublicSettings(publicationId);
    isPrivate = Boolean(publicSettings.security?.isPrivate);
  } catch {
    return reply.status(503).send({
      errors: [
        {
          code: "PRIVACY_STATE_UNAVAILABLE",
          message: "Site privacy state is unavailable",
          requestId: request.id,
        },
      ],
    });
  }

  if (!isPrivate) return;

  const token = request.cookies?.[SITE_AUTH_COOKIE_NAME] as string | undefined;
  const hasSiteAuth = verifySiteAuthToken(
    token,
    getSitePrivacySecret(),
    publicationId,
  );
  if (!hasSiteAuth) {
    return reply.status(403).send({
      errors: [
        {
          code: "PRIVATE_SITE_AUTH_REQUIRED",
          message: "Private site authentication required",
          requestId: request.id,
        },
      ],
    });
  }
}

export async function mediaStreamRoutes(fastify: FastifyInstance) {
  const canonicalMediaRoot =
    getConfig().system.storageLocalRoot || resolveCanonicalStorageRoot();

  // Stream-based media serving route with Range request (206) support
  fastify.get("/content/media/*", { preHandler: requirePublicMediaAccess }, async (request, reply) => {
    const rawKey = (request.params as Record<string, string>)["*"];
    if (!rawKey || typeof rawKey !== "string") return reply.status(404).send();
    if (
      rawKey.includes("\0") ||
      rawKey.includes("..") ||
      rawKey.includes("\\") ||
      path.isAbsolute(rawKey)
    ) {
      return reply.status(404).send();
    }
    let resolved = path.resolve(canonicalMediaRoot, rawKey);
    if (
      !resolved.startsWith(canonicalMediaRoot + path.sep) &&
      resolved !== canonicalMediaRoot
    ) {
      return reply.status(404).send();
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolved);
    } catch {
      // Transitional fallback check for legacy API storage directory
      const legacyMediaRoot = path.resolve(
        path.dirname(canonicalMediaRoot),
        "apps",
        "api",
        "content",
        "media",
      );
      const legacyResolved = path.resolve(legacyMediaRoot, rawKey);
      if (
        (legacyResolved.startsWith(legacyMediaRoot + path.sep) ||
          legacyResolved === legacyMediaRoot) &&
        fs.existsSync(legacyResolved)
      ) {
        resolved = legacyResolved;
        stat = await fs.promises.stat(resolved);
        request.log.warn(
          {
            rawKey,
            servedFrom: "transitional_legacy_root",
            canonicalPath: path.resolve(canonicalMediaRoot, rawKey),
            removalCondition:
              "Vibress v1.2.0 or upon completed sync via scripts/sync-media-storage.ts",
          },
          "Serving media asset from transitional legacy root. Run scripts/sync-media-storage.ts to migrate.",
        );
      } else {
        return reply.status(404).send();
      }
    }

    try {
      if (!stat.isFile()) {
        return reply.status(404).send();
      }

      const fileSize = stat.size;
      const mimeType = getMimeType(resolved);
      const rangeHeader = request.headers.range;
      const etag = `"${fileSize.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
      const lastModified = stat.mtime.toUTCString();

      reply.header("X-Content-Type-Options", "nosniff");
      if (mimeType === "image/svg+xml") {
        // SVG is active XML when opened as a document, even when uploaded by a
        // trusted author. Keep legacy assets addressable but never inline.
        reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
      }
      reply.header("Accept-Ranges", "bytes");
      reply.header("Cache-Control", "public, max-age=3600");
      reply.header("ETag", etag);
      reply.header("Last-Modified", lastModified);
      reply.header(
        "Content-Disposition",
        getContentDisposition(mimeType, resolved),
      );

      // Conditional requests (304 Not Modified) — skip for range requests
      if (!rangeHeader) {
        const ifNoneMatch = request.headers["if-none-match"];
        const ifModifiedSince = request.headers["if-modified-since"];
        if (
          (ifNoneMatch && ifNoneMatch === etag) ||
          (ifModifiedSince && new Date(ifModifiedSince) >= stat.mtime)
        ) {
          return reply.status(304).send();
        }
      }

      if (rangeHeader && typeof rangeHeader === "string") {
        const parsedRange = parseRangeHeader(rangeHeader, fileSize);

        if (parsedRange === "invalid") {
          reply.header("Content-Range", `bytes */${fileSize}`);
          return reply.status(416).send({
            errors: [
              {
                code: "RANGE_NOT_SATISFIABLE",
                message: "Requested range not satisfiable",
              },
            ],
          });
        }

        if (parsedRange) {
          const { start, end } = parsedRange;
          const chunkSize = end - start + 1;

          reply.status(206);
          reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
          reply.header("Content-Length", chunkSize);
          reply.header("Content-Type", mimeType);

          const stream = fs.createReadStream(resolved, { start, end });
          return reply.send(stream);
        }
      }

      reply.status(200);
      reply.header("Content-Length", fileSize);
      reply.header("Content-Type", mimeType);

      const stream = fs.createReadStream(resolved);
      return reply.send(stream);
    } catch {
      return reply.status(404).send();
    }
  });
}
