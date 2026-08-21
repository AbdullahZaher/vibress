import { describe, it, expect } from "vitest";
import {
  validateAndDetectFile,
  sanitizeFilename,
  computeSha256,
  extractImageDimensions,
} from "../domain/file-validator";
import {
  MediaInvalidFileError,
  MediaMimeMismatchError,
  MediaTypeNotAllowedError,
  MediaTooLargeError,
} from "../domain/errors";

describe("File Validator & Image Metadata", () => {
  it("should sanitize filenames and strip path separators", () => {
    const res = sanitizeFilename("../../etc/passwd/my-photo.png");
    expect(res.sanitizedFilename).toBe("my-photo.png");
    expect(res.extension).toBe("png");
  });

  it("should compute SHA-256 checksum correctly", () => {
    const buf = Buffer.from("vibress media content");
    const checksum = computeSha256(buf);
    expect(checksum).toBe(
      "ad3aae7d21a55eb3628cc43e273764a563c1b6efb2319ef064a48673250d795b",
    );
  });

  it("should detect valid 1x1 PNG and extract width/height", () => {
    // 1x1 pixel transparent PNG
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    const dims = extractImageDimensions(pngBuffer, "image/png");
    expect(dims).toEqual({ width: 1, height: 1 });

    const validated = validateAndDetectFile({
      filename: "test.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    expect(validated.assetType).toBe("image");
    expect(validated.mimeType).toBe("image/png");
    expect(validated.width).toBe(1);
    expect(validated.height).toBe(1);
  });

  it("should reject dangerous executable files", () => {
    expect(() =>
      validateAndDetectFile({
        filename: "script.exe",
        mimeType: "application/x-msdownload",
        buffer: Buffer.from("MZ..."),
      }),
    ).toThrow(MediaTypeNotAllowedError);

    expect(() =>
      validateAndDetectFile({
        filename: "shell.sh",
        mimeType: "application/x-sh",
        buffer: Buffer.from("#!/bin/sh"),
      }),
    ).toThrow(MediaTypeNotAllowedError);
  });

  it("should accept valid and safe SVG uploads", () => {
    const validSvg = validateAndDetectFile({
      filename: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>`,
      ),
    });
    expect(validSvg.mimeType).toBe("image/svg+xml");
    expect(validSvg.assetType).toBe("image");
    expect(validSvg.extension).toBe("svg");
    expect(validSvg.width).toBe(100);
    expect(validSvg.height).toBe(100);
  });

  it("should reject malicious SVG with embedded scripts or event handlers", () => {
    expect(() =>
      validateAndDetectFile({
        filename: "malicious.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script></svg>`,
        ),
      }),
    ).toThrow(MediaInvalidFileError);

    expect(() =>
      validateAndDetectFile({
        filename: "evil-handler.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle cx="50" cy="50" r="40"/></svg>`,
        ),
      }),
    ).toThrow(MediaInvalidFileError);
  });

  it("should reject HTML active content uploads", () => {
    expect(() =>
      validateAndDetectFile({
        filename: "index.html",
        mimeType: "text/html",
        buffer: Buffer.from("<html><body>Malicious HTML</body></html>"),
      }),
    ).toThrow(MediaTypeNotAllowedError);
  });

  it("should accept valid ICO and PDF files", () => {
    const icoBuffer = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);
    const icoResult = validateAndDetectFile({
      filename: "favicon.ico",
      mimeType: "image/x-icon",
      buffer: icoBuffer,
    });
    expect(icoResult.mimeType).toBe("image/x-icon");
    expect(icoResult.assetType).toBe("image");

    const pdfBuffer = Buffer.from("%PDF-1.4\n%...\n%%EOF");
    const pdfResult = validateAndDetectFile({
      filename: "document.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });
    expect(pdfResult.mimeType).toBe("application/pdf");
    expect(pdfResult.assetType).toBe("file");
  });

  it("should reject MIME mismatch when declared MIME differs from detected signature", () => {
    // Declared image/jpeg but buffer is fake text
    expect(() =>
      validateAndDetectFile({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("THIS IS NOT A JPEG"),
      }),
    ).toThrow(MediaMimeMismatchError);
  });

  it("should reject oversized files based on limits", () => {
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    expect(() =>
      validateAndDetectFile(
        {
          filename: "huge.png",
          mimeType: "image/png",
          buffer: pngBuffer,
        },
        {
          maxImageSize: 10, // 10 bytes max
          maxAudioSize: 1000,
          maxVideoSize: 1000,
          maxFileSize: 1000,
        },
      ),
    ).toThrow(MediaTooLargeError);
  });

  it("should reject zero-byte media files", () => {
    // Fake zero byte image
    expect(() =>
      validateAndDetectFile({
        filename: "empty.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(0),
      }),
    ).toThrow(MediaInvalidFileError);
  });
});
