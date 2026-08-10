# Upload Security Policy (Batch 4)

## Multipart Limits

- File size: 500 MB maximum (belt-level limit at Fastify multipart plugin)
- File count: 1 per request
- Field count: 10 per request

## Per-Type File Size Limits

| Type | Default Limit |
|---|---|
| Image | 20 MB |
| Audio | 100 MB |
| Video | 500 MB |
| File | 100 MB |

Configurable via `MediaLimitsConfig`.

## MIME Detection

Magic-byte detection is used to determine the actual file type:
- PNG: 89 50 4E 47
- JPEG: FF D8 FF
- GIF: 47 49 46 38
- WebP: RIFF ... WEBP
- MP4: ... ftyp
- WebM: 1A 45 DF A3 (EBML)
- OGG: 4F 67 67 53 (OggS)
- WAV: RIFF ... WAVE
- MP3: ID3 or MPEG sync

If declared MIME doesn't match detected signature, upload is rejected with `MEDIA_MIME_MISMATCH`.

## Blocked Extensions

`.exe`, `.dll`, `.bat`, `.cmd`, `.sh`, `.php`, `.pl`, `.py`, `.rb`, `.js`, `.cjs`, `.mjs`, `.html`, `.htm`, `.xhtml`, `.svg`, `.xml`, `.app`, `.vbs`, `.ps1`, `.jar`, `.scr`, `.msi`

## Blocked MIME Types

`application/x-executable`, `application/x-sh`, `application/x-msdownload`, `text/html`, `application/xhtml+xml`, `image/svg+xml`, `application/javascript`, `application/x-php`

## SVG Policy

SVG uploads (`image/svg+xml`) are **disabled by default**. SVG files are treated as active content and rejected at the MIME level.

## HTML Policy

HTML files (`text/html`) are blocked. Generic files that pass validation are served with `Content-Disposition: attachment` (download) rather than inline rendering.

## MIME Sniffing Protection

Responses from the media serving route include `X-Content-Type-Options: nosniff`.

## Path Traversal Protection

Storage keys are validated:
- No `..` or `.` path segments
- No absolute paths
- No null bytes
- Resolution must stay within configured storage root

## Filename Sanitization

Original filenames are sanitized:
- Control characters removed (`\x00-\x1F\x7F`)
- Path separators stripped
- Used only as display metadata, never as storage paths

## SHA-256 Checksum

Every uploaded file is hashed with SHA-256. The checksum is stored and can be used for integrity verification and future deduplication.

## EXIF Privacy

Image metadata extraction is limited to width, height, and format from binary headers. No EXIF/GPS metadata is extracted or stored.

## Antivirus

Full malware scanning is NOT currently provided. Unknown/suspicious binary types are rejected by the allowlist system.

## Content-Disposition

Generic file types are served with safe download semantics to prevent browser execution of potentially active content.
