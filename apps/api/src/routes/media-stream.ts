import { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.ogv':
      return 'video/ogg';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

const INLINE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'application/pdf',
]);

function getContentDisposition(mimeType: string, filePath: string): string {
  const filename = path.basename(filePath);
  if (INLINE_TYPES.has(mimeType)) {
    return `inline; filename="${filename}"`;
  }
  return `attachment; filename="${filename}"`;
}

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | 'invalid' | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const rangeStr = rangeHeader.slice(6).trim();
  const dashIdx = rangeStr.indexOf('-');
  if (dashIdx === -1) return 'invalid';

  const startStr = rangeStr.slice(0, dashIdx).trim();
  const endStr = rangeStr.slice(dashIdx + 1).trim();

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    const suffix = parseInt(endStr, 10);
    if (isNaN(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (startStr !== '' && endStr === '') {
    start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0 || start >= fileSize) return 'invalid';
    end = fileSize - 1;
  } else if (startStr !== '' && endStr !== '') {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start < 0 || start > end || start >= fileSize) return 'invalid';
    end = Math.min(end, fileSize - 1);
  } else {
    return 'invalid';
  }

  return { start, end };
}

export async function mediaStreamRoutes(fastify: FastifyInstance) {
  const mediaPath = path.resolve(process.cwd(), 'content', 'media');

  // Stream-based media serving route with Range request (206) support
  fastify.get('/content/media/*', async (request, reply) => {
    const rawKey = (request.params as Record<string, string>)['*'];
    if (!rawKey || typeof rawKey !== 'string') return reply.status(404).send();
    if (rawKey.includes('\0') || rawKey.includes('..') || rawKey.includes('\\') || path.isAbsolute(rawKey)) {
      return reply.status(404).send();
    }
    const resolved = path.resolve(mediaPath, rawKey);
    if (!resolved.startsWith(mediaPath + path.sep) && resolved !== mediaPath) {
      return reply.status(404).send();
    }
    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) {
        return reply.status(404).send();
      }

      const fileSize = stat.size;
      const mimeType = getMimeType(resolved);
      const rangeHeader = request.headers.range;
      const etag = `"${fileSize.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
      const lastModified = stat.mtime.toUTCString();

      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.header('ETag', etag);
      reply.header('Last-Modified', lastModified);
      reply.header('Content-Disposition', getContentDisposition(mimeType, resolved));

      // Conditional requests (304 Not Modified) — skip for range requests
      if (!rangeHeader) {
        const ifNoneMatch = request.headers['if-none-match'];
        const ifModifiedSince = request.headers['if-modified-since'];
        if ((ifNoneMatch && ifNoneMatch === etag) ||
            (ifModifiedSince && new Date(ifModifiedSince) >= stat.mtime)) {
          return reply.status(304).send();
        }
      }

      if (rangeHeader && typeof rangeHeader === 'string') {
        const parsedRange = parseRangeHeader(rangeHeader, fileSize);

        if (parsedRange === 'invalid') {
          reply.header('Content-Range', `bytes */${fileSize}`);
          return reply.status(416).send({
            errors: [{ code: 'RANGE_NOT_SATISFIABLE', message: 'Requested range not satisfiable' }],
          });
        }

        if (parsedRange) {
          const { start, end } = parsedRange;
          const chunkSize = end - start + 1;

          reply.status(206);
          reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          reply.header('Content-Length', chunkSize);
          reply.header('Content-Type', mimeType);

          const stream = fs.createReadStream(resolved, { start, end });
          return reply.send(stream);
        }
      }

      reply.status(200);
      reply.header('Content-Length', fileSize);
      reply.header('Content-Type', mimeType);

      const stream = fs.createReadStream(resolved);
      return reply.send(stream);
    } catch {
      return reply.status(404).send();
    }
  });
}
