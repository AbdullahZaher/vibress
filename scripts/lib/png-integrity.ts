import crypto from "node:crypto";
import zlib from "node:zlib";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// IEEE 802.3 CRC32 lookup table
const crcTable: Uint32Array = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

export function computeCrc32(buf: Buffer | Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngIhdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compressionMethod: number;
  filterMethod: number;
  interlaceMethod: number;
  channels: number;
}

export interface DecodedPng {
  ihdr: PngIhdr;
  decompressedBytes: number;
  sha256: string;
  pixelStats: {
    min: number;
    max: number;
    mean: number;
    standardDeviation: number;
    isBlankOrUniform: boolean;
  };
}

export interface ValidateImageOptions {
  expectedWidth: number;
  expectedHeight?: number;
  allowFullPageHeight?: boolean;
  minSizeBytes?: number;
  minStandardDeviation?: number;
}

export interface ImageIntegrityReport {
  isValid: boolean;
  filename: string;
  fileSizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  decompressedBytes: number;
  pixelStats: DecodedPng["pixelStats"];
  checks: {
    magicHeaderValid: boolean;
    crcValid: boolean;
    zlibDecompressed: boolean;
    dimensionsValid: boolean;
    contentNonBlank: boolean;
    sizeAboveMinimum: boolean;
  };
  error?: string;
}

/**
 * Fully decodes a PNG buffer, validates all chunk CRCs, inflates compressed IDAT
 * raster streams via zlib, inspects scanline raster data, and evaluates pixel entropy.
 */
export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error("Invalid PNG signature: buffer does not start with standard PNG magic bytes.");
  }

  let pos = 8;
  let ihdr: PngIhdr | null = null;
  const idatParts: Buffer[] = [];
  let foundIend = false;

  while (pos + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(pos);
    const chunkType = buffer.toString("ascii", pos + 4, pos + 8);
    const dataStart = pos + 8;
    const dataEnd = dataStart + chunkLength;
    const crcOffset = dataEnd;

    if (crcOffset + 4 > buffer.length) {
      throw new Error(`Corrupted PNG: unexpected EOF while reading chunk "${chunkType}".`);
    }

    const chunkData = buffer.subarray(dataStart, dataEnd);
    const chunkTypeAndData = buffer.subarray(pos + 4, dataEnd);
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = computeCrc32(chunkTypeAndData);

    if (expectedCrc !== actualCrc) {
      throw new Error(
        `Corrupted PNG: CRC32 mismatch in chunk "${chunkType}". Expected ${expectedCrc}, computed ${actualCrc}.`,
      );
    }

    pos = crcOffset + 4;

    if (chunkType === "IHDR") {
      if (chunkLength !== 13) {
        throw new Error(`Invalid IHDR length: expected 13 bytes, got ${chunkLength}.`);
      }
      const width = chunkData.readUInt32BE(0);
      const height = chunkData.readUInt32BE(4);
      const bitDepth = chunkData[8];
      const colorType = chunkData[9];
      const compressionMethod = chunkData[10];
      const filterMethod = chunkData[11];
      const interlaceMethod = chunkData[12];

      if (width === 0 || height === 0) {
        throw new Error(`Invalid image dimensions in IHDR: ${width}x${height}.`);
      }

      // Determine channel count based on PNG color type
      // 0: Grayscale (1)
      // 2: Truecolor RGB (3)
      // 3: Indexed color (1)
      // 4: Grayscale + Alpha (2)
      // 6: Truecolor RGBA (4)
      let channels = 3;
      if (colorType === 0 || colorType === 3) channels = 1;
      else if (colorType === 4) channels = 2;
      else if (colorType === 6) channels = 4;

      ihdr = {
        width,
        height,
        bitDepth,
        colorType,
        compressionMethod,
        filterMethod,
        interlaceMethod,
        channels,
      };
    } else if (chunkType === "IDAT") {
      idatParts.push(chunkData);
    } else if (chunkType === "IEND") {
      foundIend = true;
      break;
    }
  }

  if (!ihdr) {
    throw new Error("Missing required IHDR chunk in PNG.");
  }

  if (!foundIend) {
    throw new Error("Truncated PNG: missing required IEND chunk.");
  }

  if (idatParts.length === 0) {
    throw new Error("Invalid PNG: missing IDAT image data chunks.");
  }

  const compressedData = Buffer.concat(idatParts);
  let decompressed: Buffer;
  try {
    decompressed = zlib.inflateSync(compressedData);
  } catch (err: any) {
    throw new Error(`Failed to decompress PNG raster stream: ${err.message}`);
  }

  // Validate decompressed raster stream length for non-interlaced images
  if (ihdr.interlaceMethod === 0) {
    const bytesPerPixel = Math.ceil((ihdr.channels * ihdr.bitDepth) / 8);
    const scanlineBytes = 1 + ihdr.width * bytesPerPixel;
    const expectedLength = ihdr.height * scanlineBytes;

    if (decompressed.length !== expectedLength) {
      throw new Error(
        `PNG raster stream length mismatch: expected ${expectedLength} bytes for ${ihdr.width}x${ihdr.height} image, decompressed ${decompressed.length} bytes.`,
      );
    }
  }

  // Compute pixel raster statistics to detect completely blank or single-color canvas
  let min = 255;
  let max = 0;
  let sum = 0;
  let sampleCount = 0;

  const bytesPerPixel = Math.ceil((ihdr.channels * ihdr.bitDepth) / 8);
  const scanlineBytes = 1 + ihdr.width * bytesPerPixel;

  // Iterate over pixel data only, skipping scanline filter type bytes (offset 0 of each scanline)
  const scanlineStep = Math.max(1, Math.floor(ihdr.height / 200));
  const pixelStep = Math.max(1, Math.floor((ihdr.width * bytesPerPixel) / 200));

  for (let y = 0; y < ihdr.height; y += scanlineStep) {
    const scanlineOffset = y * scanlineBytes + 1; // skip filter byte
    const scanlinePixelBytes = ihdr.width * bytesPerPixel;
    for (let x = 0; x < scanlinePixelBytes; x += pixelStep) {
      const val = decompressed[scanlineOffset + x];
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      sampleCount++;
    }
  }

  const mean = sampleCount > 0 ? sum / sampleCount : 0;
  let varianceSum = 0;
  for (let y = 0; y < ihdr.height; y += scanlineStep) {
    const scanlineOffset = y * scanlineBytes + 1;
    const scanlinePixelBytes = ihdr.width * bytesPerPixel;
    for (let x = 0; x < scanlinePixelBytes; x += pixelStep) {
      const diff = decompressed[scanlineOffset + x] - mean;
      varianceSum += diff * diff;
    }
  }
  const variance = sampleCount > 0 ? varianceSum / sampleCount : 0;
  const standardDeviation = Math.sqrt(variance);

  // Blank or uniform check: if range is trivial (max - min < 5) and standardDeviation < 1.0
  const isBlankOrUniform = max - min < 5 || standardDeviation < 1.0;

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    ihdr,
    decompressedBytes: decompressed.length,
    sha256,
    pixelStats: {
      min,
      max,
      mean,
      standardDeviation,
      isBlankOrUniform,
    },
  };
}

/**
 * Validates a PNG file against explicit scenario criteria, checking magic bytes,
 * chunk CRC integrity, zlib deflation, viewport dimensions, and blank-image guards.
 */
export function validateImageIntegrity(
  buffer: Buffer,
  filename: string,
  options: ValidateImageOptions,
): ImageIntegrityReport {
  const minSizeBytes = options.minSizeBytes ?? 5000;
  const minStdDev = options.minStandardDeviation ?? 1.5;

  const sizeAboveMinimum = buffer.length >= minSizeBytes;

  try {
    const decoded = decodePng(buffer);

    let dimensionsValid = decoded.ihdr.width === options.expectedWidth;
    if (options.allowFullPageHeight) {
      if (options.expectedHeight) {
        dimensionsValid = dimensionsValid && decoded.ihdr.height >= options.expectedHeight;
      }
    } else if (options.expectedHeight) {
      dimensionsValid = dimensionsValid && decoded.ihdr.height === options.expectedHeight;
    }

    const contentNonBlank =
      !decoded.pixelStats.isBlankOrUniform && decoded.pixelStats.standardDeviation >= minStdDev;

    const isValid = sizeAboveMinimum && dimensionsValid && contentNonBlank;

    return {
      isValid,
      filename,
      fileSizeBytes: buffer.length,
      sha256: decoded.sha256,
      width: decoded.ihdr.width,
      height: decoded.ihdr.height,
      decompressedBytes: decoded.decompressedBytes,
      pixelStats: decoded.pixelStats,
      checks: {
        magicHeaderValid: true,
        crcValid: true,
        zlibDecompressed: true,
        dimensionsValid,
        contentNonBlank,
        sizeAboveMinimum,
      },
      error: !isValid
        ? !dimensionsValid
          ? `Dimension mismatch: decoded ${decoded.ihdr.width}x${decoded.ihdr.height}, expected ${options.expectedWidth}x${options.expectedHeight ?? "*"}`
          : !contentNonBlank
            ? `Image is blank or lacks meaningful visual variance (stdDev: ${decoded.pixelStats.standardDeviation.toFixed(2)})`
            : `File size too small (${buffer.length} < ${minSizeBytes} bytes)`
        : undefined,
    };
  } catch (err: any) {
    return {
      isValid: false,
      filename,
      fileSizeBytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      width: 0,
      height: 0,
      decompressedBytes: 0,
      pixelStats: {
        min: 0,
        max: 0,
        mean: 0,
        standardDeviation: 0,
        isBlankOrUniform: true,
      },
      checks: {
        magicHeaderValid: false,
        crcValid: false,
        zlibDecompressed: false,
        dimensionsValid: false,
        contentNonBlank: false,
        sizeAboveMinimum,
      },
      error: `PNG validation failed: ${err.message}`,
    };
  }
}
