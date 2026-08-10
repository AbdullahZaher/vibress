import { describe, it, expect } from 'vitest';
import {
  validateAndDetectFile,
  sanitizeFilename,
  computeSha256,
  extractImageDimensions,
} from '../domain/file-validator';
import {
  MediaInvalidFileError,
  MediaMimeMismatchError,
  MediaTypeNotAllowedError,
  MediaTooLargeError,
} from '../domain/errors';

describe('File Validator & Image Metadata', () => {
  it('should sanitize filenames and strip path separators', () => {
    const res = sanitizeFilename('../../etc/passwd/my-photo.png');
    expect(res.sanitizedFilename).toBe('my-photo.png');
    expect(res.extension).toBe('png');
  });

  it('should compute SHA-256 checksum correctly', () => {
    const buf = Buffer.from('vibress media content');
    const checksum = computeSha256(buf);
    expect(checksum).toBe('ad3aae7d21a55eb3628cc43e273764a563c1b6efb2319ef064a48673250d795b');
  });

  it('should detect valid 1x1 PNG and extract width/height', () => {
    // 1x1 pixel transparent PNG
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    const dims = extractImageDimensions(pngBuffer, 'image/png');
    expect(dims).toEqual({ width: 1, height: 1 });

    const validated = validateAndDetectFile({
      filename: 'test.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    expect(validated.assetType).toBe('image');
    expect(validated.mimeType).toBe('image/png');
    expect(validated.width).toBe(1);
    expect(validated.height).toBe(1);
  });

  it('should reject dangerous executable files', () => {
    expect(() =>
      validateAndDetectFile({
        filename: 'script.exe',
        mimeType: 'application/x-msdownload',
        buffer: Buffer.from('MZ...'),
      })
    ).toThrow(MediaTypeNotAllowedError);

    expect(() =>
      validateAndDetectFile({
        filename: 'shell.sh',
        mimeType: 'application/x-sh',
        buffer: Buffer.from('#!/bin/sh'),
      })
    ).toThrow(MediaTypeNotAllowedError);
  });

  it('should reject SVG and HTML active content uploads', () => {
    expect(() =>
      validateAndDetectFile({
        filename: 'logo.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg></svg>'),
      })
    ).toThrow(MediaTypeNotAllowedError);

    expect(() =>
      validateAndDetectFile({
        filename: 'index.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<html></html>'),
      })
    ).toThrow(MediaTypeNotAllowedError);
  });

  it('should reject MIME mismatch when declared MIME differs from detected signature', () => {
    // Declared image/jpeg but buffer is fake text
    expect(() =>
      validateAndDetectFile({
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('THIS IS NOT A JPEG'),
      })
    ).toThrow(MediaMimeMismatchError);
  });

  it('should reject oversized files based on limits', () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    expect(() =>
      validateAndDetectFile(
        {
          filename: 'huge.png',
          mimeType: 'image/png',
          buffer: pngBuffer,
        },
        {
          maxImageSize: 10, // 10 bytes max
          maxAudioSize: 1000,
          maxVideoSize: 1000,
          maxFileSize: 1000,
        }
      )
    ).toThrow(MediaTooLargeError);
  });

  it('should reject zero-byte media files', () => {
    // Fake zero byte image
    expect(() =>
      validateAndDetectFile({
        filename: 'empty.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(0),
      })
    ).toThrow(MediaInvalidFileError);
  });
});
