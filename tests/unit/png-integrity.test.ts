import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import {
  decodePng,
  validateImageIntegrity,
  computeCrc32,
} from "../../scripts/lib/png-integrity";

function createMockPng(options: {
  width: number;
  height: number;
  pixelValues?: number[];
  corruptCrc?: boolean;
  truncate?: boolean;
  filterType?: 0 | 1 | 2 | 3 | 4;
}): Buffer {
  const { width, height, pixelValues, corruptCrc, truncate, filterType = 0 } = options;
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // RGB (3 bytes per pixel)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrTypeAndData = Buffer.concat([Buffer.from("IHDR", "ascii"), ihdrData]);
  const ihdrCrc = corruptCrc ? 0x12345678 : computeCrc32(ihdrTypeAndData);
  const ihdrChunk = Buffer.alloc(4 + 4 + 13 + 4);
  ihdrChunk.writeUInt32BE(13, 0);
  ihdrTypeAndData.copy(ihdrChunk, 4);
  ihdrChunk.writeUInt32BE(ihdrCrc, 21);

  // Uncompressed raster data: height scanlines, each: [filterByte (0), R, G, B, R, G, B, ...]
  const scanlineBytes = 1 + width * 3;
  const rawRaster = Buffer.alloc(height * scanlineBytes);
  for (let y = 0; y < height; y++) {
    const offset = y * scanlineBytes;
    rawRaster[offset] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const pxOffset = offset + 1 + x * 3;
      if (pixelValues && pixelValues.length > 0) {
        const val = pixelValues[(y * width + x) % pixelValues.length];
        rawRaster[pxOffset] = val;
        rawRaster[pxOffset + 1] = val;
        rawRaster[pxOffset + 2] = val;
      } else {
        // Uniform color (e.g. 128)
        rawRaster[pxOffset] = 128;
        rawRaster[pxOffset + 1] = 128;
        rawRaster[pxOffset + 2] = 128;
      }
    }
  }

  if (filterType !== 0) {
    const rowBytes = width * 3;
    const original = Buffer.from(rawRaster);
    for (let y = 0; y < height; y++) {
      const offset = y * scanlineBytes;
      rawRaster[offset] = filterType;
      for (let x = 0; x < rowBytes; x++) {
        const here = original[offset + 1 + x];
        const left = x >= 3 ? original[offset + 1 + x - 3] : 0;
        const above = y ? original[offset + 1 + x - scanlineBytes] : 0;
        const upperLeft = y && x >= 3 ? original[offset + 1 + x - scanlineBytes - 3] : 0;
        let predictor = 0;
        if (filterType === 1) predictor = left;
        else if (filterType === 2) predictor = above;
        else if (filterType === 3) predictor = Math.floor((left + above) / 2);
        else if (filterType === 4) {
          const p = left + above - upperLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - above), pc = Math.abs(p - upperLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        }
        rawRaster[offset + 1 + x] = (here - predictor + 256) & 255;
      }
    }
  }
  const compressedIdat = zlib.deflateSync(rawRaster);
  const idatTypeAndData = Buffer.concat([Buffer.from("IDAT", "ascii"), compressedIdat]);
  const idatCrc = computeCrc32(idatTypeAndData);
  const idatChunk = Buffer.alloc(4 + 4 + compressedIdat.length + 4);
  idatChunk.writeUInt32BE(compressedIdat.length, 0);
  idatTypeAndData.copy(idatChunk, 4);
  idatChunk.writeUInt32BE(idatCrc, 4 + 4 + compressedIdat.length);

  // IEND chunk
  const iendTypeAndData = Buffer.from("IEND", "ascii");
  const iendCrc = computeCrc32(iendTypeAndData);
  const iendChunk = Buffer.alloc(4 + 4 + 0 + 4);
  iendChunk.writeUInt32BE(0, 0);
  iendTypeAndData.copy(iendChunk, 4);
  iendChunk.writeUInt32BE(iendCrc, 8);

  const fullPng = Buffer.concat([PNG_MAGIC, ihdrChunk, idatChunk, iendChunk]);

  if (truncate) {
    return fullPng.subarray(0, fullPng.length - 20);
  }

  return fullPng;
}

describe("PNG Integrity & Decoding Verification (P1)", () => {
  it("successfully decodes a valid PNG and computes correct dimensions and raster metrics", () => {
    // Generate an image with high pixel diversity
    const pattern = Array.from({ length: 100 }, (_, i) => (i * 17) % 256);
    const png = createMockPng({ width: 50, height: 50, pixelValues: pattern });

    const decoded = decodePng(png);
    expect(decoded.ihdr.width).toBe(50);
    expect(decoded.ihdr.height).toBe(50);
    expect(decoded.ihdr.channels).toBe(3);
    expect(decoded.decompressedBytes).toBe(50 * (1 + 50 * 3));
    expect(decoded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(decoded.pixelStats.isBlankOrUniform).toBe(false);
    expect(decoded.pixelStats.standardDeviation).toBeGreaterThan(10);
  });

  it("reconstructs all standard PNG scanline filters before checking visual variance", () => {
    const gradient = Array.from({ length: 37 }, (_, i) => (i * 29) % 256);
    for (const filterType of [0, 1, 2, 3, 4] as const) {
      const decoded = decodePng(createMockPng({ width: 24, height: 24, pixelValues: gradient, filterType }));
      expect(decoded.pixelStats.isBlankOrUniform).toBe(false);
      expect(decoded.pixelStats.standardDeviation).toBeGreaterThan(10);
    }
    const flat = decodePng(createMockPng({ width: 20, height: 20, filterType: 4 }));
    expect(flat.pixelStats.isBlankOrUniform).toBe(true);
  });

  it("detects completely uniform or blank images", () => {
    // Uniform image (all pixels = 128)
    const uniformPng = createMockPng({ width: 40, height: 40 });
    const decoded = decodePng(uniformPng);

    expect(decoded.pixelStats.isBlankOrUniform).toBe(true);
    expect(decoded.pixelStats.standardDeviation).toBe(0);
  });

  it("fails closed when magic PNG signature is invalid", () => {
    const invalidHeader = Buffer.from("NOT_A_PNG_HEADER_TEST");
    expect(() => decodePng(invalidHeader)).toThrow(/Invalid PNG signature/);
  });

  it("fails closed on CRC32 checksum corruption", () => {
    const corruptPng = createMockPng({ width: 30, height: 30, corruptCrc: true });
    expect(() => decodePng(corruptPng)).toThrow(/CRC32 mismatch in chunk "IHDR"/);
  });

  it("fails closed on truncated PNG missing IEND", () => {
    const truncatedPng = createMockPng({ width: 30, height: 30, truncate: true });
    expect(() => decodePng(truncatedPng)).toThrow(/Truncated PNG|unexpected EOF/);
  });

  it("validates dimensions accurately, including fullPage height tolerance", () => {
    const pattern = Array.from({ length: 500 }, (_, i) => (i * 23) % 256);
    const png = createMockPng({ width: 320, height: 1200, pixelValues: pattern });

    // Exact viewport match should fail if height is expected to be 900
    const exactReport = validateImageIntegrity(png, "test.png", {
      expectedWidth: 320,
      expectedHeight: 900,
      allowFullPageHeight: false,
      minSizeBytes: 50,
    });
    expect(exactReport.isValid).toBe(false);
    expect(exactReport.error).toContain("Dimension mismatch");

    // FullPage height tolerance should pass when height >= 900
    const fullPageReport = validateImageIntegrity(png, "test-fullpage.png", {
      expectedWidth: 320,
      expectedHeight: 900,
      allowFullPageHeight: true,
      minSizeBytes: 50,
    });
    expect(fullPageReport.isValid).toBe(true);
    expect(fullPageReport.checks.dimensionsValid).toBe(true);
    expect(fullPageReport.checks.contentNonBlank).toBe(true);
  });

  it("rejects images below minimum file size", () => {
    const pattern = [10, 50, 100, 200];
    const smallPng = createMockPng({ width: 10, height: 10, pixelValues: pattern });

    const report = validateImageIntegrity(smallPng, "small.png", {
      expectedWidth: 10,
      expectedHeight: 10,
      minSizeBytes: 50000, // higher than actual
    });

    expect(report.isValid).toBe(false);
    expect(report.checks.sizeAboveMinimum).toBe(false);
    expect(report.error).toContain("File size too small");
  });
});

